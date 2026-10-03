/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-api.test.ts: Tests for the UniFi Access API client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import type { AccessDeviceConfig } from '../src/unifi/index.js';
import { createMockDeviceConfig } from './mocks/unifi-access.js';

// A stand-in for the WebSocket client, so we can drive the events API from our tests.
class FakeWebSocket extends EventEmitter {

  public static instances: FakeWebSocket[] = [];

  public close = vi.fn(() => this.emit('close'));
  public terminate = vi.fn();

  constructor(public url: string, public options: Record<string, unknown>) {

    super();
    FakeWebSocket.instances.push(this);
  }
}

vi.mock('../src/lib/request.js', () => ({ request: vi.fn() }));
vi.mock('../src/lib/websocket.js', () => ({ WebSocketClient: FakeWebSocket }));

const { request } = await import('../src/lib/request.js');
const { AccessApi } = await import('../src/unifi/access-api.js');

const requestMock = vi.mocked(request);

// Build a response in the shape our request utility returns.
function response(statusCode: number, body: unknown = {}, headers: Record<string, string> = {}): Awaited<ReturnType<typeof request>> {

  return {

    body: {

      arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(0),
      json: async (): Promise<unknown> => (typeof body === 'string') ? JSON.parse(body) : body,
      text: async (): Promise<string> => (typeof body === 'string') ? body : JSON.stringify(body),
    },
    headers,
    statusCode,
  };
}

const LOGIN_HEADERS = { 'set-cookie': 'TOKEN=abc123; path=/; secure', 'x-updated-csrf-token': 'csrf-2' };

const BOOTSTRAP = {

  alias: 'My Controller',
  device_groups: [[ createMockDeviceConfig({ alias: 'Top Level', mac: '11:22:33:44:55:66', unique_id: 'top-level' }) ]],
  floors: [
    { doors: [ { device_groups: [[ createMockDeviceConfig({ unique_id: 'door-device' }) ]], name: 'Front', unique_id: 'door-1' } ] },
    { doors: [] },
  ],
};

// Route requests by URL, returning a response for each endpoint the API client calls during login and bootstrap.
function routeRequests(overrides: Record<string, () => ReturnType<typeof response>> = {}): void {

  requestMock.mockImplementation(async (url: string) => {

    for(const [ fragment, handler ] of Object.entries(overrides)) {

      if(url.includes(fragment)) {

        return handler();
      }
    }

    if(url.endsWith('/api/auth/login')) {

      return response(200, {}, LOGIN_HEADERS);
    }

    if(url.endsWith('access/info')) {

      return response(200, { data: { host: { mac: 'AA:AA:AA:AA:AA:AA' }, version: '2.0.0' } });
    }

    if(url.endsWith('devices/topology4')) {

      return response(200, { data: [ BOOTSTRAP ] });
    }

    // The CSRF token prefetch.
    return response(200, {}, { 'x-csrf-token': 'csrf-1' });
  });
}

function createLog(): { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {

  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('AccessApi', () => {

  let log: ReturnType<typeof createLog>;
  let api: InstanceType<typeof AccessApi>;

  beforeEach(() => {

    FakeWebSocket.instances = [];
    requestMock.mockReset();
    log = createLog();
    api = new AccessApi(log);
  });

  afterEach(() => {

    api.close();
    vi.useRealTimers();
  });

  describe('login', () => {

    it('stores the session cookie and CSRF token and sends them on subsequent requests', async () => {

      routeRequests();

      const onLogin = vi.fn();

      api.on('login', onLogin);

      expect(await api.login('10.0.0.1', 'user', 'pass')).toBe(true);
      expect(onLogin).toHaveBeenCalledWith(true);

      const loginCall = requestMock.mock.calls.find(([ url ]) => url === 'https://10.0.0.1/api/auth/login');

      expect(loginCall?.[1].method).toBe('POST');
      expect(JSON.parse(loginCall?.[1].body as string)).toMatchObject({ password: 'pass', username: 'user' });
      expect(loginCall?.[1].headers).toMatchObject({ 'x-csrf-token': 'csrf-1' });

      await api.retrieve('https://10.0.0.1/proxy/access/api/v2/anything');

      expect(requestMock.mock.lastCall?.[1].headers).toMatchObject({ cookie: 'TOKEN=abc123', 'x-csrf-token': 'csrf-2' });
    });

    it('fails when the controller does not return a session cookie', async () => {

      routeRequests({ '/api/auth/login': () => response(200, {}, { 'x-csrf-token': 'csrf-2' }) });

      expect(await api.login('10.0.0.1', 'user', 'pass')).toBe(false);
    });

    it('fails when the controller rejects the credentials', async () => {

      routeRequests({ '/api/auth/login': () => response(401) });

      expect(await api.login('10.0.0.1', 'user', 'wrong')).toBe(false);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid login credentials'), expect.anything());
    });

    it('logs out on a 401 while retaining the CSRF token', async () => {

      routeRequests();
      await api.login('10.0.0.1', 'user', 'pass');

      requestMock.mockResolvedValueOnce(response(401));

      expect(await api.retrieve('https://10.0.0.1/expired')).toBeNull();

      routeRequests();
      await api.retrieve('https://10.0.0.1/next');

      expect(requestMock.mock.lastCall?.[1].headers).toMatchObject({ 'x-csrf-token': 'csrf-2' });
      expect(requestMock.mock.lastCall?.[1].headers).not.toHaveProperty('cookie');
    });
  });

  describe('retrieve', () => {

    it('retries only transient failures, and only for idempotent requests', async () => {

      requestMock.mockResolvedValue(response(200));

      await api.retrieve('https://10.0.0.1/get');
      await api.retrieve('https://10.0.0.1/put', { body: '{}', method: 'PUT' });

      const [ getCall, putCall ] = requestMock.mock.calls;

      expect(getCall[1].retry?.statusCodes).toEqual([ 429, 500, 502, 503, 504 ]);
      expect(putCall[1].retry).toBeUndefined();
    });

    it.each([
      [ 403, 'Insufficient privileges' ],
      [ 503, 'Unable to connect to the Access controller' ],
      [ 418, '418' ],
    ])('returns null and logs a status of %s', async (status, message) => {

      requestMock.mockResolvedValue(response(status));

      expect(await api.retrieve('https://10.0.0.1/x')).toBeNull();
      expect(log.error.mock.calls.flat().join(' ')).toContain(message);
    });

    it('suppresses error logging when asked to', async () => {

      requestMock.mockResolvedValue(response(503));

      expect(await api.retrieve('https://10.0.0.1/x', { method: 'GET' }, { logErrors: false })).toBeNull();
      expect(log.error).not.toHaveBeenCalled();
    });

    it.each([
      [ 'ECONNREFUSED', 'Connection refused' ],
      [ 'ECONNRESET', 'has been reset' ],
      [ 'ENOTFOUND', 'Hostname or IP address not found' ],
    ])('maps %s to a friendly message', async (code, message) => {

      routeRequests();
      await api.login('10.0.0.1', 'user', 'pass');
      requestMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { code }));

      expect(await api.retrieve('https://10.0.0.1/x')).toBeNull();
      expect(log.error.mock.calls.flat().join(' ')).toContain(message);
    });

    it('throttles after repeated errors and resumes once the penalty period has elapsed', async () => {

      vi.useFakeTimers();
      routeRequests();
      await api.login('10.0.0.1', 'user', 'pass');

      requestMock.mockResolvedValue(response(503));

      for(let attempt = 0; attempt < 10; attempt++) {

        await api.retrieve('https://10.0.0.1/x');
      }

      // The next call trips the throttle without touching the network.
      requestMock.mockClear();
      expect(await api.retrieve('https://10.0.0.1/x')).toBeNull();
      expect(api.isThrottled).toBe(true);
      expect(await api.retrieve('https://10.0.0.1/x')).toBeNull();
      expect(requestMock).not.toHaveBeenCalled();

      // Five minutes later we log back in and carry on.
      vi.advanceTimersByTime(300 * 1000);
      routeRequests();

      expect(await api.retrieve('https://10.0.0.1/x')).not.toBeNull();
      expect(api.isThrottled).toBe(false);
    });
  });

  describe('getBootstrap', () => {

    it('flattens doors and devices, merges top-level device groups, and connects to the events API', async () => {

      routeRequests();
      await api.login('10.0.0.1', 'user', 'pass');

      const onBootstrap = vi.fn();

      api.on('bootstrap', onBootstrap);

      expect(await api.getBootstrap()).toBe(true);

      expect(api.controller?.version).toBe('2.0.0');
      expect(api.doors?.map(door => door.unique_id)).toEqual([ 'door-1' ]);
      expect(api.devices?.map(device => device.unique_id)).toEqual([ 'door-device', 'top-level' ]);
      expect(api.name).toBe('My Controller');
      expect(onBootstrap).toHaveBeenCalledTimes(1);

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.instances[0].url).toBe('wss://10.0.0.1/proxy/access/api/v2/ws/notification');
      expect(FakeWebSocket.instances[0].options).toMatchObject({ headers: { Cookie: 'TOKEN=abc123' }, maxPayload: 4 * 1024 * 1024 });
      expect(FakeWebSocket.instances[0].options.agent).toBeInstanceOf(https.Agent);
    });

    it('expands Enterprise Access Hubs into one device per door', async () => {

      const eah = createMockDeviceConfig({
        alias: 'Lobby EAH',
        device_type: 'UAH-Ent',
        display_model: 'UA Hub Enterprise',
        extensions: [
          { extension_name: 'port_setting', source_id: 'port1', target_name: 'North Door', target_value: 'door-north' },
          { extension_name: 'port_setting', source_id: 'port2', target_name: 'South Door', target_value: 'door-south' },
        ] as unknown as AccessDeviceConfig['extensions'],
        unique_id: 'eah',
      });

      routeRequests({ 'devices/topology4': () => response(200, { data: [ { device_groups: [[ eah ]], floors: [] } ] }) });
      await api.login('10.0.0.1', 'user', 'pass');
      await api.getBootstrap();

      const doors = api.devices?.filter(device => device.source_id?.startsWith('port'));

      expect(doors?.map(door => [ door.alias, door.location_id, door.display_model, door.name ])).toEqual([
        [ 'North Door', 'door-north', 'UA Hub Enterprise Port1', 'Lobby EAH' ],
        [ 'South Door', 'door-south', 'UA Hub Enterprise Port2', 'Lobby EAH' ],
      ]);
    });

    it('retries once and fails when the bootstrap cannot be parsed', async () => {

      routeRequests({ 'devices/topology4': () => response(200, 'not json') });
      await api.login('10.0.0.1', 'user', 'pass');
      requestMock.mockClear();

      expect(await api.getBootstrap()).toBe(false);
      expect(requestMock.mock.calls.filter(([ url ]) => url.endsWith('devices/topology4'))).toHaveLength(2);
    });
  });

  describe('events API', () => {

    beforeEach(async () => {

      routeRequests();
      await api.login('10.0.0.1', 'user', 'pass');
      await api.getBootstrap();
    });

    it('emits decoded event packets and ignores heartbeats', () => {

      const onMessage = vi.fn();

      api.on('message', onMessage);
      FakeWebSocket.instances[0].emit('message', '"Hello"\n');
      FakeWebSocket.instances[0].emit('message', JSON.stringify({ event: 'access.data.device.update' }));

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({ event: 'access.data.device.update' });
    });

    it('reconnects promptly when the connection drops unexpectedly', async () => {

      vi.useFakeTimers();
      FakeWebSocket.instances[0].emit('close');

      // The reconnect is backed off by about a second, with jitter.
      await vi.advanceTimersByTimeAsync(1300);

      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('reconnects when the heartbeat goes missing', async () => {

      vi.useFakeTimers();

      // Arm the heartbeat watchdog under fake timers, then let it lapse.
      FakeWebSocket.instances[0].emit('message', '"Hello"\n');
      await vi.advanceTimersByTimeAsync(10 * 1000);

      expect(FakeWebSocket.instances[0].terminate).toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to detect heartbeat'), expect.anything());

      await vi.advanceTimersByTimeAsync(1300);

      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('does not reconnect once closed', async () => {

      vi.useFakeTimers();
      api.close();
      FakeWebSocket.instances[0].emit('close');

      await vi.advanceTimersByTimeAsync(120 * 1000);

      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  describe('unlock', () => {

    const hub = createMockDeviceConfig({
      extensions: [ { extension_name: 'port_setting', target_value: 'door-7' } ] as unknown as AccessDeviceConfig['extensions'],
      unique_id: 'hub-1',
    });

    beforeEach(async () => {

      routeRequests();
      await api.login('10.0.0.1', 'user', 'pass');
      requestMock.mockClear();
    });

    it('refuses to unlock devices that are not hubs', async () => {

      expect(await api.unlock(createMockDeviceConfig({ capabilities: ['is_reader'] }))).toBe(false);
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('uses the door location endpoint for a standard unlock', async () => {

      requestMock.mockResolvedValue(response(200, { codeS: 'SUCCESS' }));

      expect(await api.unlock(hub)).toBe(true);
      expect(requestMock).toHaveBeenCalledWith('https://10.0.0.1/proxy/access/api/v2/location/door-7/unlock', expect.objectContaining({ method: 'PUT' }));
    });

    it.each([
      [ 0, { type: 'reset' } ],
      [ -5, { type: 'reset' } ],
      [ Infinity, { type: 'keep_unlock' } ],
      [ 5.7, { interval: 5, type: 'custom' } ],
    ])('sends the right lock rule for a duration of %s', async (duration, payload) => {

      requestMock.mockResolvedValue(response(200, { codeS: 'SUCCESS' }));

      expect(await api.unlock(hub, duration)).toBe(true);

      const [ url, options ] = requestMock.mock.lastCall ?? [];

      expect(url).toBe('https://10.0.0.1/proxy/access/api/v2/device/hub-1/lock_rule?get_result=true');
      expect(JSON.parse(options?.body as string)).toEqual(payload);
    });

    it.each([
      [ 'an error code', { codeS: 'CODE_DEVICE_OFFLINE' } ],
      [ 'invalid JSON', 'not json' ],
      [ 'a JSON null body', 'null' ],
    ])('returns false without throwing when the controller responds with %s', async (_label, body) => {

      requestMock.mockResolvedValue(response(200, body));

      await expect(api.unlock(hub)).resolves.toBe(false);
    });

    it('returns false when the request fails', async () => {

      requestMock.mockResolvedValue(response(500));

      expect(await api.unlock(hub)).toBe(false);
    });
  });

  describe('getApiEndpoint', () => {

    it.each([
      [ 'bootstrap', 'https://10.0.0.1/proxy/access/api/v2/devices/topology4' ],
      [ 'controller', 'https://10.0.0.1/proxy/access/api/v2/access/info' ],
      [ 'login', 'https://10.0.0.1/api/auth/login' ],
      [ 'unknown', '' ],
    ])('maps %s', async (endpoint, url) => {

      routeRequests();
      await api.login('10.0.0.1', 'user', 'pass');

      expect(api.getApiEndpoint(endpoint)).toBe(url);
    });
  });
});
