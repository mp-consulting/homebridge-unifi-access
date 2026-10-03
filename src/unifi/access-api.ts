/* Copyright(C) 2019-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-api.ts: Our UniFi Access API implementation, built exclusively on Node.js runtime primitives.
 */
import type { AccessBootstrapConfig, AccessControllerConfig, AccessDeviceConfig, AccessDoorConfig, AccessFloorConfig } from './access-types.js';
import type { HomebridgePluginLogging, Nullable } from '../lib/util.js';
import type { RequestResponse } from '../lib/request.js';
import { request } from '../lib/request.js';
import { type AccessTlsPinOptions, AccessTlsPin, createAccessAgent } from './access-api-tls.js';
import { WebSocketClient } from '../lib/websocket.js';
import { EventEmitter } from 'node:events';
import { STATUS_CODES } from 'node:http';
import type https from 'node:https';
import util from 'node:util';

// Number of API errors to accept before we backoff so we don't slam an Access controller.
const ACCESS_API_ERROR_LIMIT = 10;

// Interval, in seconds, to wait before trying to access the API again once we've hit the ACCESS_API_ERROR_LIMIT threshold.
const ACCESS_API_RETRY_INTERVAL = 300;

// Access API response timeout, in milliseconds. This should never be greater than 5000 ms.
const ACCESS_API_TIMEOUT = 3500;

// How long, in milliseconds, we wait for a heartbeat from the events API before we consider the connection dead. Access sends one every five seconds.
const ACCESS_EVENTS_HEARTBEAT_TIMEOUT = 10 * 1000;

// Cap on the size of a single events API message, in bytes. Events are modest JSON documents - this is far above anything Access sends, while keeping a broken
// or hostile endpoint from making us buffer arbitrarily large frames.
const ACCESS_EVENTS_MAX_PAYLOAD = 4 * 1024 * 1024;

// Bounds, in milliseconds, for the exponential backoff we use when reconnecting to the events API after losing the connection.
const ACCESS_EVENTS_RECONNECT_MIN = 1000;
const ACCESS_EVENTS_RECONNECT_MAX = 60 * 1000;

// HTTP status codes that indicate a transient condition worth retrying. Client errors such as 400 and 404 won't resolve themselves, so we don't retry those.
const ACCESS_API_RETRY_STATUS_CODES = [ 429, 500, 502, 503, 504 ];

// Options to tailor an individual request to the Access controller.
export interface RequestOptions {

  body?: string;
  headers?: Record<string, string>;
  method?: string;
}

// Options to tailor the behavior of AccessApi.retrieve.
export interface RetrieveOptions {

  logErrors?: boolean;
  timeout?: number;
}

// Options to tailor the behavior of the Access API client. When strict TLS validation is off - the default, since UniFi controllers ship with self-signed
// certificates - the controller's certificate is pinned on first use instead, as described by AccessTlsPinOptions.
export interface AccessApiOptions extends AccessTlsPinOptions {

  verifyTls?: boolean;
}

/**
 * The UniFi Access API is partially documented through an officially supported public API that Ubiquiti has released, and this implementation provides the
 * additional subset of the native API that the plugin needs: login, bootstrap enumeration, device unlocks, and the realtime notification events WebSocket.
 *
 * 1. {@link login | Login} to the UniFi Access controller and acquire security credentials for further calls to the API.
 *
 * 2. Enumerate the list of UniFi Access devices by calling {@link getBootstrap}. Information about the Access controller is available through the {@link
 * controller}    property, and the devices, doors, and floors through their respective properties.
 *
 * 3. Listen for `message` events emitted by {@link AccessApi} containing all Access controller events, in realtime, delivered as
 *    {@link access-types.AccessEventPacket} packets.
 */
export class AccessApi extends EventEmitter {

  private _bootstrap: Nullable<AccessBootstrapConfig>;
  private _controller: Nullable<AccessControllerConfig>;
  private _devices: Nullable<AccessDeviceConfig[]>;
  private _doors: Nullable<AccessDoorConfig[]>;
  private _floors: Nullable<AccessFloorConfig[]>;
  private _isThrottled: boolean;
  private address: string;
  private agent: Nullable<https.Agent>;
  private apiErrorCount: number;
  private apiLastSuccess: number;
  private events: Nullable<WebSocketClient>;
  private eventsAgent: Nullable<https.Agent>;
  private eventsReconnectAttempts: number;
  private eventsReconnectTimer: Nullable<NodeJS.Timeout>;
  private eventsTimer: Nullable<NodeJS.Timeout>;
  private isClosed: boolean;
  private headers: Record<string, string>;
  private log: HomebridgePluginLogging;
  private password: string;
  private readonly pin: AccessTlsPin;
  private username: string;
  private verifyTls: boolean;

  // Initialize this instance with our login information.
  constructor(log?: HomebridgePluginLogging, options: AccessApiOptions = {}) {

    // Initialize our parent.
    super();

    // UniFi controllers ship with self-signed certificates, so we skip TLS certificate validation by default. Setups with proper certificates can opt in to
    // strict validation.
    this.verifyTls = options.verifyTls ?? false;

    // If we didn't get passed a logging parameter, by default we log to the console.
    log ??= {

       
      debug: () => {},
      error: (message: string, ...parameters: unknown[]) => console.error(message, ...parameters),
      info: (message: string, ...parameters: unknown[]) => console.log(message, ...parameters),
      warn: (message: string, ...parameters: unknown[]) => console.log(message, ...parameters),
       
    };

    this._bootstrap = null;
    this._controller = null;
    this._devices = null;
    this._doors = null;
    this._floors = null;
    this._isThrottled = false;
    this.agent = null;
    this.events = null;
    this.eventsAgent = null;
    this.eventsReconnectAttempts = 0;
    this.eventsReconnectTimer = null;
    this.eventsTimer = null;
    this.isClosed = false;

    this.log = {

      debug: (message: string, ...parameters: unknown[]) => log.debug('%s: ' + message, this.name, ...parameters),
      error: (message: string, ...parameters: unknown[]) => log.error('%s: API error: ' + message, this.name, ...parameters),
      info: (message: string, ...parameters: unknown[]) => log.info('%s: ' + message, this.name, ...parameters),
      warn: (message: string, ...parameters: unknown[]) => log.warn('%s: ' + message, this.name, ...parameters),
    };

    // When strict validation is off, we pin the controller's certificate on first use and refuse connections that present a different certificate thereafter.
    this.pin = new AccessTlsPin(this.log, options);

    this.apiErrorCount = 0;
    this.apiLastSuccess = 0;
    this.headers = {};
    this.address = '';
    this.username = '';
    this.password = '';
  }

  // Login to the Access controller and terminate any existing login we might have.
  public async login(address: string, username: string, password: string): Promise<boolean> {

    this.address = address;
    this.username = username;
    this.password = password;
    this.isClosed = false;

    this.logout();

    // Let's attempt to login.
    const loginSuccess = await this.loginController();

    // Publish the result to our listeners.
    this.emit('login', loginSuccess);

    // Return the status of our login attempt.
    return loginSuccess;
  }

  // Login to the UniFi Access API.
  private async loginController(): Promise<boolean> {

    // If we're already logged in, we're done.
    if(this.headers.cookie && this.headers['x-csrf-token']) {

      return true;
    }

    // Utility to grab the headers we're interested in a normalized manner.
    const getHeader = (name: string, headers?: RequestResponse['headers']): Nullable<string> => {

      const rawHeader = headers?.[name.toLowerCase()];

      if(!rawHeader) {

        return null;
      }

      // Normalize it to a string.
      return Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    };

    // Acquire a CSRF token, if needed. We only need to do this if we aren't already logged in, or we don't already have a token.
    if(!this.headers['x-csrf-token']) {

      // UniFi OS has cross-site request forgery protection built into it's web management UI. We retrieve the CSRF token, if available, by connecting to the
      // Access controller and checking the headers for it.
      const response = await this.retrieve('https://' + this.address, { method: 'GET' }, { logErrors: false });

      if(this.responseOk(response?.statusCode)) {

        const csrfToken = getHeader('X-CSRF-Token', response?.headers);

        // Preserve the CSRF token, if found, for future API calls.
        if(csrfToken) {

          this.headers['x-csrf-token'] = csrfToken;
        }
      }
    }

    // Log us in.
    const response = await this.retrieve(this.getApiEndpoint('login'), {

      body: JSON.stringify({ password: this.password, rememberMe: true, token: '', username: this.username }),
      method: 'POST',
    });

    // Something went wrong with the login call, possibly a controller reboot or failure.
    if(!this.responseOk(response?.statusCode)) {

      this.logout();

      return false;
    }

    // We're logged in. Let's configure our headers.
    const csrfToken = getHeader('X-Updated-CSRF-Token', response?.headers) ?? getHeader('X-CSRF-Token', response?.headers);
    const cookie = getHeader('Set-Cookie', response?.headers);

    // Save the refreshed cookie and CSRF token for future API calls and we're done.
    if(csrfToken && cookie) {

      // Only preserve the token element of the cookie and not the superfluous information that's been added to it.
      this.headers.cookie = cookie.split(';')[0];

      // Save the CSRF token.
      this.headers['x-csrf-token'] = csrfToken;

      return true;
    }

    // Clear out our login credentials.
    this.logout();

    return false;
  }

  // Attempt to retrieve the bootstrap configuration from the Access controller.
  private async bootstrapController(retry: boolean): Promise<boolean> {

    // Log us in if needed.
    if(!(await this.loginController())) {

      return retry ? this.bootstrapController(false) : false;
    }

    // Utility to retrieve and parse API responses, with error handling.
    const retrieveEndpoint = async (endpoint: string): Promise<Nullable<Record<string, unknown>>> => {

      // Retrieve the endpoint from the controller.
      const response = await this.retrieve(this.getApiEndpoint(endpoint));

      // Something went wrong. Retry the bootstrap attempt once, and then we're done.
      if(!this.responseOk(response?.statusCode)) {

        this.logRetry('Unable to retrieve the UniFi Access ' + endpoint + ' configuration.', retry);

        return null;
      }

      let data: Nullable<Record<string, unknown>>;

      try {

        data = await response?.body.json() as Record<string, unknown>;
      } catch(error) {

        data = null;
        this.log.error('Unable to parse response from UniFi Access. Will retry again later.');
      }

      return data;
    };

    // Retrieve the controller configuration.
    this._controller = ((await retrieveEndpoint('controller'))?.data ?? null) as Nullable<AccessControllerConfig>;

    if(!this._controller && retry) {

      return this.bootstrapController(false);
    }

    // Next, retrieve the bootstrap configuration.
    const data = (await retrieveEndpoint('bootstrap'))?.data as Nullable<AccessBootstrapConfig[]> | undefined;

    this._bootstrap = data ? data[0] : null;

    if(!this._bootstrap && retry) {

      return this.bootstrapController(false);
    }

    // Retrieve the list of doors from all the floors the user has configured.
    this._doors = this._bootstrap?.floors?.flatMap(floor => floor.doors).filter(Boolean) as Nullable<AccessDoorConfig[]> ?? null;

    // In case we end up with an empty floors array due to changes in the Access API, we can conceivably end up with an empty array here.
    this._doors = this._doors?.length ? this._doors : null;

    // Retrieve the list of devices from all the doors the user has configured.
    this._devices = (this._doors?.map(x => x.device_groups ?? []).flat(2).filter(Boolean) ?? null) as Nullable<AccessDeviceConfig[]>;

    // Some controllers expose device_groups at the top level in addition to (or instead of) within the floors/doors hierarchy. We merge them here.
    if(Array.isArray(this._bootstrap?.device_groups)) {

      const topLevelDeviceGroups = this._bootstrap.device_groups.flat().filter(Boolean) as AccessDeviceConfig[];

      this._devices = (this._devices ?? []).concat(topLevelDeviceGroups);
    }

    // In case we end up with an empty devices array due to changes in the Access API, we can conceivably end up with an empty array here.
    this._devices = this._devices?.length ? this._devices : null;

    // Account for Enterprise Access Hubs. What we do here is append to the devices array a transformed version of each extension (which in the case of an EAH
    // amounts to the equivalent of a hub / lock) attached to it. We transform the configuration to make it appear like it's a typical UAH for our purposes, and
    // we map the
    // name and unlock location accordingly.
     
    const eahDevices = this._bootstrap?.device_groups?.flat().filter(device => device.device_type === 'UAH-Ent')
      .flatMap(({ extensions = [], alias, display_model, location_id, ...device }) => extensions
        .map(({ target_name, target_value, ...extension }) => ({ ...device, ...extension, alias: target_name ?? 'Unknown',
          display_model: display_model + ((extension.source_id !== undefined) ? ' ' + extension.source_id.replace(/(^\w|\s+\w)/g, match => match.toUpperCase()) : ''),
          location_id: target_value ?? location_id, name: alias }))) as unknown as AccessDeviceConfig[] | undefined;
     

    // Add EAH devices, if we have them.
    if(eahDevices?.length) {

      this._devices ??= [];
      this._devices.push(...eahDevices);
    }

    // Set the list of floors as a convenience.
    this._floors = (this._bootstrap?.floors ?? null) as Nullable<AccessFloorConfig[]>;

    // If we're bootstrapped, connect to the event listener API. Otherwise, we're done.
    if(!this._bootstrap || !(await this.launchEventsWs())) {

      return retry ? this.bootstrapController(false) : false;
    }

    // We're connected again, so reset our reconnection backoff.
    this.eventsReconnectAttempts = 0;

    // Notify our users.
    this.emit('bootstrap', this._bootstrap);

    // We're bootstrapped and connected to the events API.
    return true;
  }

  // Connect to the realtime events API.
  private async launchEventsWs(): Promise<boolean> {

    // Log us in if needed.
    if(!(await this.loginController())) {

      return false;
    }

    // If we already have a listener, we're already all set.
    if(this.events) {

      return true;
    }

    try {

      const ws = new WebSocketClient('wss://' + this.address + '/proxy/access/api/v2/ws/notification',
        { agent: this.getEventsAgent(), headers: { Cookie: this.headers.cookie ?? '' }, maxPayload: ACCESS_EVENTS_MAX_PAYLOAD });

      // Cleanup after ourselves if our websocket closes for some reason. If it's still our active connection, we lost it unexpectedly - reconnect rather than
      // waiting for the next scheduled bootstrap refresh, so we don't miss events in the meantime.
      ws.once('close', () => {

        ws.removeAllListeners();

        if(this.events !== ws) {

          return;
        }

        if(this.eventsTimer) {

          clearTimeout(this.eventsTimer);
          this.eventsTimer = null;
        }

        this.events = null;
        this.scheduleEventsReconnect();
      });

      // Handle any websocket errors.
      ws.on('error', (error: Error) => {

        this.log.error('Events API error: %s', error.message);
        this.log.debug(util.inspect(error, { colors: false, depth: null, sorted: true }));
        ws.close();
      });

      // Process messages as they come in.
      ws.on('message', (data: Buffer | string) => {

        // No event data - we're done.
        if(!data) {

          return;
        }

        const message = data.toString();

        // The Access events API seems to send a heartbeat every five seconds.
        if(message === '"Hello"\n') {

          // Heartbeat.
          this.armEventsHeartbeat();

          return;
        }

        // Access events are published as JSON objects.
        try {

          // Emit the decoded packet for users.
          this.emit('message', JSON.parse(message));
        } catch(error) {

          this.log.error('Error processing message from the events API: %s', error);

          return;
        }
      });

      // Make the websocket available, and then we're done.
      this.events = ws;

      // Establish our heartbeat.
      this.armEventsHeartbeat();
    } catch(error) {

      this.log.error('Error connecting to the realtime update events API: %s', error);

      return false;
    }

    return true;
  }

  // The agent for our events API connection. It applies the same certificate policy as our API requests, but doesn't pool connections since the events API is
  // a single long-lived connection.
  private getEventsAgent(): https.Agent {

    this.eventsAgent ??= createAccessAgent(this.verifyTls, this.pin, { keepAlive: false });

    return this.eventsAgent;
  }

  // Arm (or re-arm) the watchdog that detects a silently dead events API connection.
  private armEventsHeartbeat(): void {

    if(this.eventsTimer) {

      clearTimeout(this.eventsTimer);
    }

    this.eventsTimer = setTimeout(() => {

      this.log.error('Failed to detect heartbeat from the events API. Resetting the connection.');
      this.reset();
      this.scheduleEventsReconnect();
    }, ACCESS_EVENTS_HEARTBEAT_TIMEOUT);
  }

  // Schedule a reconnection to the events API using exponential backoff with jitter. Reconnecting re-bootstraps, so that our view of the controller reflects
  // anything we may have missed while disconnected.
  private scheduleEventsReconnect(): void {

    // We've been deliberately closed, or we already have a reconnection pending.
    if(this.isClosed || this.eventsReconnectTimer) {

      return;
    }

    const backoff = Math.min(ACCESS_EVENTS_RECONNECT_MAX, ACCESS_EVENTS_RECONNECT_MIN * (2 ** this.eventsReconnectAttempts));
    const delay = Math.round(backoff * (0.8 + (Math.random() * 0.4)));

    this.eventsReconnectAttempts++;
    this.log.debug('Reconnecting to the events API in %s ms.', delay);

    this.eventsReconnectTimer = setTimeout(() => {

      this.eventsReconnectTimer = null;

      void this.getBootstrap().then(success => {

        if(!success) {

          this.scheduleEventsReconnect();
        }
      });
    }, delay);

    this.eventsReconnectTimer.unref();
  }

  // Get our UniFi Access configuration, and attempt to retry the bootstrap if it fails.
  public async getBootstrap(): Promise<boolean> {

    return this.bootstrapController(true);
  }

  // Send an unlock command to a hub. If duration (in minutes) is not specified, a standard unlock request will be sent, unlocking for approximately 2 seconds.
  // Valid values for duration are Infinity (remain unlocked until reset), 0 (reset lock to secure state), or a number of minutes.
  public async unlock(device: AccessDeviceConfig, duration?: number): Promise<boolean> {

    // No device object, we're done.
    if(!device) {

      return false;
    }

    // Unlocking only works on hubs.
    if(!device.capabilities.includes('is_hub')) {

      return false;
    }

    // Default to the standard unlock endpoint.
    let action = 'unlock';
    let endpoint;
    let payload = {};

    // If we've specified a duration, let's specify that.
    if(duration !== undefined) {

      const params = new URLSearchParams({ get_result: 'true' });

      endpoint = this.getApiEndpoint('device') + '/' + device.unique_id + '/lock_rule?' + params.toString();

      // Safety check for out of bounds values.
      if(duration < 0) {

        duration = 0;
      }

      switch(duration) {

        case 0:

          action = 'lock';
          payload = { type: 'reset' };

          break;

        case Infinity:

          payload = { type: 'keep_unlock' };

          break;

        default:

          payload = { interval: Math.trunc(duration), type: 'custom' };
      }
    } else {

      // For undefined duration, use the generic location unlock endpoint (for gates). We prefer the door/gate location from extensions over the device's
      // building location.
      const locationId = device.extensions?.find(ext => ext.extension_name === 'port_setting')?.target_value ?? device.location_id;

      endpoint = this.getApiEndpoint('location') + '/' + locationId + '/unlock';
    }

    // Request the unlock from Access.
    const response = await this.retrieve(endpoint, {

      body: JSON.stringify(payload),
      method: 'PUT',
    });

    if(!this.responseOk(response?.statusCode)) {

      this.log.error('%s: Unable to %s the %s: %s.', this.getFullName(device), action, device.display_model, response?.statusCode);

      return false;
    }

    // Get our status. The response body isn't guaranteed to be valid JSON (e.g. a UniFi OS service mid-restart or a reverse proxy can return an empty 2xx),
    // and some of our callers invoke unlock without awaiting it - a parse throw here would become an unhandled rejection that takes down the process.
    let status: { codeS?: string };

    try {

      status = await response?.body.json() as { codeS?: string };
    } catch(error) {

      this.log.error('%s: Unable to %s the %s: invalid response received: %s.', this.getFullName(device), action, device.display_model,
        error instanceof Error ? error.message : String(error));

      return false;
    }

    // A body of JSON null parses successfully, so we guard against it explicitly.
    if(status?.codeS === 'SUCCESS') {

      return true;
    }

    // We failed - let's log what we know.
    this.log.error('%s: Error %sing the %s: \n%s', this.getFullName(device), action, device.display_model,
      util.inspect(status, { colors: false, depth: null, sorted: true }));

    return false;
  }

  // Utility to generate a nicely formatted device string.
  public getDeviceName(device: AccessDeviceConfig, name: string | undefined = device.alias?.length ? device.alias : device.name, deviceInfo = false): string {

    // Include the host address information, if we have it.
    const host = (('ip' in device) && device.ip) ? 'address: ' + device.ip + ' ' : '';
    const type = (('display_model' in device) && device.display_model) ? device.display_model : device.device_type;

    // A completely enumerated device will appear as: Device Name [Device Type] (address: IP address, mac: MAC address).
    return (name ?? type) + ' [' + type + ']' + (deviceInfo ? ' (' + host + 'mac: ' + device.mac.replace(/:/g, '').toUpperCase() + ')' : '');
  }

  // Utility to generate a nicely formatted controller and device string.
  public getFullName(device: AccessDeviceConfig): string {

    const deviceName = this.getDeviceName(device);

    // Returns: Controller [Controller Type] Device Name [Device Type]
    return this.name + (deviceName.length ? ' ' + deviceName : '');
  }

  // Utility to disconnect from the Access controller and reset the connection.
  public reset(): void {

    this._bootstrap = null;
    this._floors = null;
    this._doors = null;
    this._devices = null;

    if(this.eventsTimer) {

      clearTimeout(this.eventsTimer);
    }

    this.eventsTimer = null;

    this.events?.terminate();
    this.events = null;

    if(this.address) {

      // Cleanup any prior connection pool.
      this.agent?.destroy();

      // Create a connection pool that applies our certificate policy - strict validation, or our trust-on-first-use pin - before any request data is sent. We
      // allow up to five connections at a time.
      this.agent = createAccessAgent(this.verifyTls, this.pin, { keepAlive: true, maxSockets: 5 });
    }
  }

  // Permanently close our connection to the Access controller. Unlike logout, this also stops any automatic reconnection to the events API until we login
  // again.
  public close(): void {

    this.isClosed = true;

    if(this.eventsReconnectTimer) {

      clearTimeout(this.eventsReconnectTimer);
      this.eventsReconnectTimer = null;
    }

    this.logout();
    this.agent?.destroy();
    this.agent = null;
    this.eventsAgent?.destroy();
    this.eventsAgent = null;
  }

  // Utility to clear out old login credentials or attempts.
  public logout(): void {

    // Close any connection to the Access API.
    this.reset();

    // Save our CSRF token, if we have one.
    const csrfToken = this.headers['x-csrf-token'];

    // Initialize the headers we need.
    this.headers = {};
    this.headers['content-type'] = 'application/json';
    this.headers['user-agent'] = 'unifi-access';

    // Restore the CSRF token if we have one.
    if(csrfToken) {

      this.headers['x-csrf-token'] = csrfToken;
    }
  }

  // Execute an HTTP fetch request to the Access controller. This handles authentication and session management, automatic retry with backoff, error logging,
  // and throttling. Returns the response, or null on failure.
  public async retrieve(url: string, options: RequestOptions = { method: 'GET' }, retrieveOptions: RetrieveOptions = {}): Promise<Nullable<RequestResponse>> {

    // Set our defaults unless the user has overriden them.
    retrieveOptions.logErrors ??= true;
    retrieveOptions.timeout ??= ACCESS_API_TIMEOUT;

    // Log errors if that's what the caller requested.
    const logError = (message: string, ...parameters: unknown[]): void => {

      if(!retrieveOptions.logErrors) {

        return;
      }

      this.log.error(message, ...parameters);
    };

    // Catch Access controller server-side issues:
    //
    // 400: Bad request.
    // 404: Not found.
    // 429: Too many requests.
    // 500: Internal server error.
    // 502: Bad gateway.
    // 503: Service temporarily unavailable.
    const serverErrors = new Set([ 400, 404, 429, 500, 502, 503 ]);

    let response;

    // Create a signal handler to deliver the abort operation.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), retrieveOptions.timeout);

    try {

      const now = Date.now();

      // Throttle this after ACCESS_API_ERROR_LIMIT attempts.
      if(this.apiErrorCount >= ACCESS_API_ERROR_LIMIT) {

        // Let the user know we've got an API problem.
        if(!this._isThrottled) {

          this.apiLastSuccess = now;
          this._isThrottled = true;

          this.log.error('Throttling API calls due to errors with the %s previous attempts. Pausing communication with the Access controller for %s minutes.',
            this.apiErrorCount++, ACCESS_API_RETRY_INTERVAL / 60);

          this.reset();

          return null;
        }

        // Check to see if we are still throttling our API calls.
        if((this.apiLastSuccess + (ACCESS_API_RETRY_INTERVAL * 1000)) > now) {

          return null;
        }

        // Inform the user that we're out of the penalty box and try again.
        this.log.error('Resuming connectivity to the UniFi Access API after pausing for %s minutes.', ACCESS_API_RETRY_INTERVAL / 60);

        this.apiErrorCount = 0;
        this._isThrottled = false;

        if(!(await this.loginController())) {

          return null;
        }
      }

      response = await request(url, {

        agent: this.agent ?? undefined,
        body: options.body,
        headers: { ...this.headers, ...options.headers },
        method: options.method ?? 'GET',
        // Only retry idempotent requests. Retrying a login or an unlock that the controller may have already acted upon risks repeating it.
        retry: [ 'GET', 'HEAD' ].includes((options.method ?? 'GET').toUpperCase()) ?
          { factor: 2, maxRetries: 5, maxTimeout: 1500, minTimeout: 100, statusCodes: ACCESS_API_RETRY_STATUS_CODES } : undefined,
        signal: controller.signal,
      });

      // Preemptively increase the error count.
      this.apiErrorCount++;

      // Bad username and password.
      if(response.statusCode === 401) {

        this.logout();
        logError('Invalid login credentials given. Please check your login and password.');

        return null;
      }

      // Insufficient privileges.
      if(response.statusCode === 403) {

        logError('Insufficient privileges for this user. Please check the roles assigned to this user and ensure it has sufficient privileges.');

        return null;
      }

      if(!this.responseOk(response.statusCode)) {

        if(serverErrors.has(response.statusCode)) {

          logError('Unable to connect to the Access controller. This is usually temporary and will occur during device reboots.');

          return null;
        }

        // Some other unknown error occurred.
        logError('%s - %s', response.statusCode, STATUS_CODES[response.statusCode]);

        return null;
      }

      this.apiLastSuccess = Date.now();
      this.apiErrorCount = 0;
      this._isThrottled = false;

      return response;
    } catch(error) {

      // Increment our API error count.
      this.apiErrorCount++;

      // We aborted the connection due to a timeout.
      if(controller.signal.aborted || ((error instanceof Error) && (error.name === 'AbortError'))) {

        logError('Access controller is taking too long to respond to a request. This error can usually be safely ignored.');
        this.log.debug('Original request was: %s', url);

        return null;
      }

      // Map the more common network errors to something more user-friendly.
      const cause = (error instanceof Error) && ('code' in error) && (typeof (error as NodeJS.ErrnoException).code === 'string') ?
        error as NodeJS.ErrnoException : null;

      if(cause) {

        switch(cause.code) {

          case 'ECONNREFUSED':
          case 'EHOSTDOWN':

            logError('Connection refused.');

            break;

          case 'ECONNRESET':

            logError('Network connection to Access controller has been reset.');

            break;

          case 'ENOTFOUND':

            if(this.address) {

              logError('Hostname or IP address not found: %s. Please ensure the address you configured for this UniFi Access controller is correct.', this.address);
            } else {

              logError('No hostname or IP address provided.');
            }

            break;

          default:

            // If we're logging when we have an error, do so.
            logError('Error: %s | %s.', cause.code, cause.message);

            break;
        }

        return null;
      }

      logError('Unknown error: %s', util.inspect(error, { colors: false, depth: null, sorted: true }));

      return null;
    } finally {

      // Clear out our response timeout.
      clearTimeout(timer);
    }
  }

  // Utility function for logging connection retries.
  private logRetry(logMessage: string, isRetry: boolean): void {

    // If we're over the API limit, no need to continue indicating errors since we already inform users we're throttling API calls.
    if(this.apiErrorCount >= ACCESS_API_ERROR_LIMIT) {

      return;
    }

    // If we're retrying, only log when debugging.
    if(isRetry) {

      this.log.debug('%s Retrying.', logMessage);
    } else {

      this.log.error(logMessage);
    }
  }

  // Utility to check return status from a call to request.
  public responseOk(code?: number): boolean {

    if(code === undefined) {

      return false;
    }

    return (code >= 200) && (code < 300);
  }

  // Return the appropriate URL to access various Access API endpoints.
  public getApiEndpoint(endpoint: string): string {

    let endpointSuffix;
    let endpointPrefix = '/proxy/access/api/v2/';

    switch(endpoint) {

      case 'bootstrap':

        endpointSuffix = 'devices/topology4';

        break;

      case 'controller':

        endpointSuffix = 'access/info';

        break;

      case 'device':

        endpointSuffix = 'device';

        break;

      case 'location':

        endpointSuffix = 'location';

        break;

      case 'login':

        endpointPrefix = '/api/';
        endpointSuffix = 'auth/login';

        break;

      case 'self':

        endpointPrefix = '/api/';
        endpointSuffix = 'users/self';

        break;

      case 'settings':

        endpointSuffix = 'settings';

        break;

      case 'websocket':

        endpointSuffix = 'ws';

        break;

      default:

        break;
    }

    if(!endpointSuffix) {

      return '';
    }

    return 'https://' + this.address + endpointPrefix + endpointSuffix;
  }

  // Get the controller JSON.
  public get controller(): Nullable<AccessControllerConfig> {

    return this._controller;
  }

  // Get the bootstrap JSON.
  public get bootstrap(): Nullable<AccessBootstrapConfig> {

    return this._bootstrap;
  }

  // Get the list of devices.
  public get devices(): Nullable<AccessDeviceConfig[]> {

    return this._devices;
  }

  // Get the list of doors.
  public get doors(): Nullable<AccessDoorConfig[]> {

    return this._doors;
  }

  // Get the list of floors.
  public get floors(): Nullable<AccessFloorConfig[]> {

    return this._floors;
  }

  // The SHA-256 fingerprint of the controller certificate we've pinned, if any. Always undefined when strict validation is enabled.
  public get tlsFingerprint(): string | undefined {

    return this.verifyTls ? undefined : this.pin.fingerprint;
  }

  // Return whether our connection to the Access controller is currently throttled or not.
  public get isThrottled(): boolean {

    return this._isThrottled;
  }

  // Utility to generate a nicely formatted controller string.
  public get name(): string {

    // Our controller string, if it exists, appears as `Controller`. Otherwise, we appear as `address`.
    if(this._bootstrap?.alias?.length || this._bootstrap?.name?.length) {

      return this._bootstrap.alias?.length ? this._bootstrap.alias : this._bootstrap.name ?? 'Unknown';
    }

    return this.address;
  }
}
