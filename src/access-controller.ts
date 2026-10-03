/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-controller.ts: Access controller device class for UniFi Access.
 */
import {
  ACCESS_CONTROLLER_REFRESH_INTERVAL, ACCESS_CONTROLLER_RETRY_INTERVAL, PLATFORM_NAME, PLUGIN_NAME, createPrefixedLogger, isValidAddress, normalizeMac,
} from './settings.js';
import type { API, HAP, PlatformAccessory } from 'homebridge';
import { AccessApi, type AccessControllerConfig, type AccessDeviceConfig } from './unifi/index.js';
import { type HomebridgePluginLogging, MqttClient, type Nullable, retry, sanitizeName, sleep } from './lib/index.js';
import type { AccessControllerOptions } from './access-options.js';
import type { AccessDevice } from './access-device.js';
import { AccessEventType } from './access-types.js';
import { AccessEvents } from './access-events.js';
import { AccessHub } from './hub/index.js';
import type { AccessPlatform } from './access-platform.js';
import { deviceIdentifier, getDeviceCatalog } from './access-device-catalog.js';
import util from 'node:util';

// Check if a device has supported hub or reader capabilities.
function isSupportedDevice(device: AccessDeviceConfig): boolean {

  return [ 'is_hub', 'is_reader' ].some(capability => device.capabilities.includes(capability));
}

export class AccessController {

  private api: API;
  public config: AccessControllerOptions;
  private deviceRemovalQueue: Record<string, number>;
  public readonly configuredDevices: Record<string, AccessDevice | undefined>;
  public events!: AccessEvents;
  private hap: HAP;
  public logApiErrors: boolean;
  public readonly log: HomebridgePluginLogging;
  public mqtt: MqttClient | null;
  private name: string;
  public platform: AccessPlatform;
  public uda: AccessControllerConfig;
  public udaApi!: AccessApi;
  private bootstrapRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly retryInterval: number;
  private isConfigValid: boolean;
  private unsupportedDevices: Record<string, boolean>;

  constructor(platform: AccessPlatform, accessOptions: AccessControllerOptions) {

    this.api = platform.api;
    this.config = accessOptions;
    this.configuredDevices = {};
    this.deviceRemovalQueue = {};
    this.hap = this.api.hap;
    this.isConfigValid = false;

    // How long to wait between connection attempts. We add up to 20% of jitter so that multiple controllers recovering from the same outage don't retry in
    // lockstep.
    this.retryInterval = Math.round(ACCESS_CONTROLLER_RETRY_INTERVAL * 1000 * (1 + (Math.random() * 0.2)));
    this.logApiErrors = true;
    this.mqtt = null;
    this.name = accessOptions.name ?? accessOptions.address;
    this.platform = platform;
    this.uda = {} as AccessControllerConfig;
    this.unsupportedDevices = {};

    // Configure our logging.
    this.log = createPrefixedLogger(this.platform.log, this.platform.debug.bind(this.platform), () => this.name);

    // Validate our controller address and login information.
    if(!accessOptions.address || !accessOptions.username || !accessOptions.password) {

      return;
    }

    // Validate that the controller address is not a loopback, link-local, or otherwise invalid address.
    if(!isValidAddress(accessOptions.address)) {

      this.log.error('Invalid controller address: %s. Please provide a valid network address.', accessOptions.address);

      return;
    }

    this.isConfigValid = true;
  }

  // Retrieve the bootstrap configuration from the Access controller.
  private async bootstrapController(): Promise<void> {

    // Attempt to bootstrap the controller until we're successful.
    await retry(async () => this.udaApi.getBootstrap(), this.retryInterval);
  }

  // Shut down our connection to the Access controller, releasing our timers and network connections.
  public shutdown(): void {

    clearTimeout(this.bootstrapRefreshTimer);
    this.bootstrapRefreshTimer = undefined;

    // We may be shutting down before we've ever connected.
    this.udaApi?.close();
    this.mqtt?.end();
    this.mqtt = null;
  }

  // Initialize our connection to the UniFi Access controller.
  public async login(): Promise<void> {

    // We've already told the user what's wrong with this controller's configuration - there's nothing to connect to.
    if(!this.isConfigValid) {

      return;
    }

    // The plugin has been disabled globally. Let the user know that we're done here.
    if(!this.hasFeature('Device')) {

      this.log.info('Disabling this UniFi Access controller.');

      return;
    }

    // Initialize our connection to the UniFi Access API.
    const udaLog = {

      debug: (message: string, ...parameters: unknown[]): void => this.platform.debug(message, ...parameters),
      error: (message: string, ...parameters: unknown[]): void => {

        if(this.logApiErrors) {

          this.platform.log.error(util.format(message, ...parameters));
        }
      },
      info: (message: string, ...parameters: unknown[]): void => this.platform.log.info(util.format(message, ...parameters)),
      warn: (message: string, ...parameters: unknown[]): void => this.platform.log.warn(util.format(message, ...parameters)),
    };

    // Create our connection to the Access API. UniFi controllers ship with self-signed certificates, so rather than validating the certificate chain we pin
    // the controller's certificate the first time we see it and refuse to talk to anything presenting a different certificate thereafter. Setups with proper
    // certificates can opt in to strict validation through the verifyTls controller option instead.
    const verifyTls = this.config.verifyTls === true;

    this.udaApi = new AccessApi(udaLog, {

      onFingerprint: (fingerprint: string): void => this.platform.tlsPins.set(this.config.address, fingerprint),
      onFingerprintMismatch: (): void => this.log.error('If you have replaced or regenerated the certificate on your controller, remove the entry for %s from %s ' +
        'and restart Homebridge to trust the new certificate.', this.config.address, this.platform.tlsPins.filename),
      pinnedFingerprint: verifyTls ? undefined : this.platform.tlsPins.get(this.config.address),
      verifyTls,
    });

    // Attempt to login to the Access controller, retrying at reasonable intervals. This accounts for cases where the Access controller or the network
    // connection may not be fully available when we startup.
    await retry(async () => this.udaApi.login(this.config.address, this.config.username, this.config.password), this.retryInterval);

    // Now, let's get the bootstrap configuration from the Access controller.
    await this.bootstrapController();

    // Set our Access configuration from the controller.
    this.uda = this.udaApi.controller as AccessControllerConfig;

    // Assign our name if the user hasn't explicitly specified a preference.
    this.name = this.config.name ?? this.udaApi.name;

    // We successfully logged in.
    this.log.info('Connected to %s (UniFi Access %s running on UniFi OS %s).', this.config.address, this.uda.version, this.uda.host.firmware_version);

    // Now that we know the Access controller configuration, check to see if we've disabled it.
    if(!this.hasFeature('Device')) {

      this.udaApi.logout();
      this.log.info('Disabling this UniFi Access controller in HomeKit.');

      // Let's sleep for thirty seconds to give all the accessories a chance to load before disabling everything. Homebridge doesn't have a good mechanism
      // to notify us when all the cached accessories are loaded at startup.
      await sleep(30);

      // Unregister all the accessories for this controller from Homebridge that may have been restored already. Any additional ones will be automatically
      // caught when they are restored.
      this.platform.accessories.filter(accessory => accessory.context.controller === this.uda.host.mac)
        .map(accessory => this.removeHomeKitDevice(accessory, true));

      return;
    }

    // Initialize our UniFi Access events handler.
    this.events = new AccessEvents(this);

    // Initialize MQTT, if needed.
    if(!this.mqtt && this.config.mqttUrl) {

      this.mqtt = new MqttClient(this.config.mqttUrl, this.config.mqttTopic, this.log, undefined, { verifyTls: this.config.mqttVerifyTls !== false });
    }

    // Inform the user about the devices we see.
    if(this.udaApi.devices) {

      for(const device of this.udaApi.devices) {

        // Filter out any devices that aren't managed by this Access controller.
        if(!device.is_managed) {

          continue;
        }

        this.log.info('Discovered %s: %s.', this.resolveDeviceModel(device), this.udaApi.getDeviceName(device, this.resolveDeviceName(device), true));
      }
    }

    // Bootstrap refresh loop. Clear any existing timer to prevent accumulation.
    const bootstrapRefresh = (): void => {

      clearTimeout(this.bootstrapRefreshTimer);
      this.bootstrapRefreshTimer = setTimeout(() => {

        this.bootstrapController().catch((error: unknown) => this.log.error('Unable to refresh the controller configuration: %s.', error));
      }, ACCESS_CONTROLLER_REFRESH_INTERVAL * 1000);
    };

    // Sync the Access controller's devices with HomeKit. Adding or removing accessories persists the accessory cache as it happens, so we don't need to
    // rewrite it on every periodic refresh.
    const syncUdaHomeKit = (): void => {

      // Sync status and check for any new or removed accessories.
      this.discoverAndSyncAccessories();
    };

    // Initialize our Access controller device sync, and refresh the accessory cache with the state we've restored and configured at startup.
    syncUdaHomeKit();
    this.api.updatePlatformAccessories(this.platform.accessories);

    // Let's set a listener to wait for bootstrap events to occur so we can keep ourselves in sync with the Access controller.
    this.udaApi.on('bootstrap', () => {

      // Sync our device view.
      syncUdaHomeKit();

      // Refresh our bootstrap.
      bootstrapRefresh();
    });

    // Kickoff our first round of bootstrap refreshes to ensure we stay in sync.
    bootstrapRefresh();
  }

  // Create instances of Access device types in our plugin.
  private addAccessDevice(accessory: PlatformAccessory, device: AccessDeviceConfig): boolean {

    // Access hubs.
    if(isSupportedDevice(device)) {

      // We have a UniFi Access hub or reader.
      this.configuredDevices[accessory.UUID] = new AccessHub(this, device, accessory);

      return true;
    }

    // Default to an unknown device type.
    this.log.error('Unknown device class %s detected for %s.', device.device_type, this.resolveDeviceName(device));

    return false;
  }

  // Discover UniFi Access devices that may have been added to the controller since we last checked.
  private discoverDevices(devices: AccessDeviceConfig[]): boolean {

    // Iterate through the list of devices that Access has returned and sync them with what we show HomeKit.
    for(const device of devices) {

      this.addHomeKitDevice(device);
    }

    return true;
  }

  // Add a newly detected Access device to HomeKit.
  public addHomeKitDevice(device: AccessDeviceConfig): boolean {

    // If we have no MAC address, name, or this device isn't being managed by this Access controller, we're done.
    if(!this.uda.host.mac || !device.mac || !device.is_managed) {

      return false;
    }

    // We only support certain device capabilities.
    if(!isSupportedDevice(device)) {

      // If we've already informed the user about this one, we're done.
      if(this.unsupportedDevices[device.mac]) {

        return false;
      }

      // Notify the user we see this device, but we aren't adding it to HomeKit.
      this.unsupportedDevices[device.mac] = true;

      this.log.info("UniFi Access device type '%s' is not currently supported, ignoring: %s.", device.device_type, this.udaApi.getDeviceName(device));

      return false;
    }

    // Generate this device's unique identifier. For multi-door devices, we append source_id to the MAC address to distinguish them.
    const catalog = getDeviceCatalog(device.device_type);
    const uuid = this.hap.uuid.generate(device.mac + (catalog?.appendsSourceId ? '-' + device.source_id.toUpperCase() : ''));

    // See if we already know about this accessory.
    let accessory = this.platform.accessories.find(x => x.UUID === uuid);

    // Enable or disable certain devices based on configuration parameters.
    if(!this.hasFeature('Device', device)) {

      if(accessory) {

        this.removeHomeKitDevice(accessory, true);
      }

      return false;
    }

    // We've got a new device, let's add it to HomeKit.
    if(!accessory) {

      accessory = new this.api.platformAccessory(sanitizeName(this.resolveDeviceName(device)), uuid);

      this.log.info('%s: Adding %s to HomeKit.', this.udaApi.getFullName(device), device.display_model);

      // Register this accessory with homebridge and add it to the accessory array so we can track it.
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.platform.accessories.push(accessory);
      this.api.updatePlatformAccessories(this.platform.accessories);
    }

    // Setup the accessory as a new Access device in HBUA if we haven't configured it yet.
    if(!this.configuredDevices[accessory.UUID]) {

      this.addAccessDevice(accessory, device);

      return true;
    }

    // Update the configuration on an existing Access device. We emit by event type so our device state is refreshed first, and then by device so that the
    // device itself can reconcile anything it may have missed while the events API was unavailable.
    const packet = { data: device, event: AccessEventType.DEVICE_UPDATE, event_object_id: device.unique_id, receiver_id: '', save_to_history: false };

    this.events.emit(AccessEventType.DEVICE_UPDATE, packet);
    this.events.emit(device.unique_id, packet);

    return true;
  }

  // Discover and sync UniFi Access devices between HomeKit and the Access controller.
  private discoverAndSyncAccessories(): boolean {

    if(!this.udaApi.bootstrap) {

      return false;
    }

    if(this.udaApi.devices && !this.discoverDevices(this.udaApi.devices)) {

      this.log.error('Error discovering devices.');
    }

    // Remove Access devices that are no longer found on this Access controller, but we still have in HomeKit.
    this.cleanupDevices();

    // Update our device information.
    Object.keys(this.configuredDevices).map(x => this.configuredDevices[x]?.configureInfo());

    return true;
  }

  // Cleanup removed Access devices from HomeKit.
  private cleanupDevices(): void {

    // Determine whether an accessory is enabled, based on the serial number we've assigned it. We use this for accessories we may no longer have a device for.
    const isAccessoryEnabled = (accessory: PlatformAccessory): boolean => this.platform.featureOptions.test('Device',
      (accessory.getService(this.hap.Service.AccessoryInformation)?.getCharacteristic(this.hap.Characteristic.SerialNumber).value ?? '') as string, this.id);

    // The devices the Access controller currently knows about, by MAC address.
    const controllerMacs = new Set(this.udaApi.devices?.map(device => device.mac.toLowerCase()));

    // Process the device removal queue before we do anything else.
    this.platform.accessories.filter(accessory => accessory.UUID in this.deviceRemovalQueue).forEach(accessory =>
      this.removeHomeKitDevice(accessory, !isAccessoryEnabled(accessory)));

    // Iterate over a copy - removing an accessory mutates the underlying array.
    for(const accessory of [...this.platform.accessories]) {

      // Child accessories are owned by their parent device rather than by device discovery, so they're never orphans in their own right. Leave them be while
      // their parent is still configured, and clean them up when it no longer is.
      if(accessory.context.childOf) {

        // Children belonging to another controller are that controller's business - we only know about our own devices.
        if((accessory.context.controller === this.uda.host.mac) && !this.configuredDevices[accessory.context.childOf as string]) {

          this.removeChildAccessory(accessory);
        }

        continue;
      }

      const accessDevice = this.configuredDevices[accessory.UUID];

      // Check to see if we have an orphan - where we haven't configured this in the plugin, but the accessory still exists in HomeKit. One example of
      // when this might happen is when Homebridge might be shutdown and a device is then removed. When we start back up, the device still exists in
      // HomeKit but not in Access. We catch those orphan devices here.
      if(!accessDevice) {

        this.removeHomeKitDevice(accessory, !isAccessoryEnabled(accessory));

        continue;
      }

      // If we don't have the Access bootstrap JSON available, we're done. We need to know what's on the Access controller in order to determine what to do with
      // the accessories we know about.
      if(!this.udaApi.bootstrap) {

        continue;
      }

      // Check to see if the device still exists on the Access controller and the user has not chosen to hide it.
      if(isSupportedDevice(accessDevice.uda) && controllerMacs.has(accessDevice.uda.mac.toLowerCase())) {

        // In case we have previously queued a device for deletion, let's remove it from the queue since it's reappeared.
        delete this.deviceRemovalQueue[accessDevice.accessory.UUID];

        continue;
      }

      // Process the device removal.
      this.removeHomeKitDevice(accessory, !accessDevice.hasFeature('Device'));
    }
  }

  // Utility to retrieve a reasonable device name for an Access device.
  private resolveDeviceName(device: AccessDeviceConfig): string {

     
    return (device.alias?.length ? device.alias : device.name) ?? device.display_model ?? device.model ?? device.device_type ?? 'Access Device';
  }

  // Utility to retrieve a reasonable device model for an Access device.
  private resolveDeviceModel(device: AccessDeviceConfig): string {

     
    return device.display_model ?? device.model ?? device.device_type ?? 'Unknown Model';
  }

  // Acquire a child accessory for an Access device, registering it with HomeKit if we haven't already. Child accessories let us expose an individual service,
  // such as a door position sensor, as its own HomeKit accessory so that it appears as a dedicated tile rather than being grouped with the lock on the
  // device's primary accessory.
  public acquireChildAccessory(device: AccessDevice, subtype: string, name: string): PlatformAccessory {

    // Derive the child's identity from its parent so that it remains stable across restarts.
    const uuid = this.hap.uuid.generate(device.accessory.UUID + '.' + subtype);

    let accessory = this.platform.accessories.find(x => x.UUID === uuid);

    if(!accessory) {

      accessory = new this.api.platformAccessory(sanitizeName(name), uuid);

      this.log.info('%s: Adding %s to HomeKit as a separate accessory.', this.udaApi.getFullName(device.uda), name);

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.platform.accessories.push(accessory);
      this.api.updatePlatformAccessories(this.platform.accessories);
    }

    // Tag the child so that we can recognize it on subsequent startups and tie its lifecycle to its parent.
    accessory.context = {};
    accessory.context.mac = device.uda.mac;
    accessory.context.controller = this.uda.host.mac;
    accessory.context.childOf = device.accessory.UUID;
    accessory.context.childSubtype = subtype;

    return accessory;
  }

  // Remove a child accessory of an Access device from HomeKit, if it exists.
  public releaseChildAccessory(device: AccessDevice, subtype: string): void {

    const uuid = this.hap.uuid.generate(device.accessory.UUID + '.' + subtype);
    const accessory = this.platform.accessories.find(x => x.UUID === uuid);

    if(!accessory) {

      return;
    }

    this.removeChildAccessory(accessory);
  }

  // Unregister a child accessory from HomeKit. Child accessories have no AccessDevice instance of their own, so they bypass the device removal machinery.
  private removeChildAccessory(accessory: PlatformAccessory): void {

    const index = this.platform.accessories.indexOf(accessory);

    if(index < 0) {

      return;
    }

    this.log.info('%s: Removing the separate accessory from HomeKit.', accessory.displayName);

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.platform.accessories.splice(index, 1);
    this.api.updatePlatformAccessories(this.platform.accessories);
  }

  // Remove an individual Access device from HomeKit.
  public removeHomeKitDevice(accessory: PlatformAccessory, noRemovalDelay = false): void {

    // Ensure that this accessory hasn't already been removed.
    if(!this.platform.accessories.some(x => x.UUID === accessory.UUID)) {

      return;
    }

    // We only remove devices if they're on the Access controller we're interested in.
    if(accessory.context.controller !== this.uda.host.mac) {

      return;
    }

    // Child accessories aren't Access devices, so they bypass the device removal machinery entirely.
    if(accessory.context.childOf) {

      this.removeChildAccessory(accessory);

      return;
    }

    const delayInterval = this.getFeatureNumber('Controller.DelayDeviceRemoval') ?? 0;

    // For certain use cases, we may want to defer removal of an Access device where Access may lose track of devices for a brief period of time.
    // This prevents a potential back-and-forth where devices are removed momentarily only to be readded later.
    if(!noRemovalDelay && delayInterval) {

      // Have we seen this device queued for removal previously? If not, let's add it to the queue and come back after our specified delay.
      if(!this.deviceRemovalQueue[accessory.UUID]) {

        this.deviceRemovalQueue[accessory.UUID] = Date.now();

        this.log.info('%s: Delaying device removal for at least %s second%s.', accessory.displayName, delayInterval, delayInterval > 1 ? 's' : '');

        return;
      }

      // Is it time to process this device removal?
      if((delayInterval * 1000) > (Date.now() - this.deviceRemovalQueue[accessory.UUID])) {

        return;
      }
    }

    // Cleanup after ourselves.
    delete this.deviceRemovalQueue[accessory.UUID];

    // Grab our instance of the Access device, if it exists.
    const accessDevice = this.configuredDevices[accessory.UUID];

    // See if we can pull the device's configuration details from our Access device instance or the controller.
    const device = accessDevice?.uda ?? this.udaApi.devices?.find(dev => dev.unique_id === accessory.context.mac.toLowerCase()) ?? null;

    this.log.info('%s: Removing %s from HomeKit.', device ? this.udaApi.getDeviceName(device) : accessDevice?.accessoryName ?? accessory.displayName,
      device?.display_model ?? 'device');

    // Cleanup our device instance.
    accessDevice?.cleanup();

    // Remove any child accessories we've split out from this device. They have no existence of their own once their parent is gone.
    for(const child of this.platform.accessories.filter(x => x.context.childOf === accessory.UUID)) {

      this.removeChildAccessory(child);
    }

    // Finally, remove it from our list of configured devices and HomeKit.
    delete this.configuredDevices[accessory.UUID];

    // Unregister the accessory and delete it's remnants from HomeKit and the plugin.
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.platform.accessories.splice(this.platform.accessories.indexOf(accessory), 1);

    // Tell Homebridge to save the updated list of accessories.
    this.api.updatePlatformAccessories(this.platform.accessories);
  }

  // Reauthenticate with the controller.
  public async resetControllerConnection(): Promise<void> {

    // Clear our login credentials and statistics.
    this.udaApi.reset();

    // Bootstrap the Access controller.
    await this.bootstrapController();
  }

  // Lookup a device by it's identifier and return it if it exists.
  public deviceLookup(deviceId: string): AccessDevice | null {

    return Object.values(this.configuredDevices).find(device => device?.uda.unique_id === deviceId) ?? null;
  }

  // Utility function to return a floating point configuration parameter on a device.
  public getFeatureFloat(option: string): Nullable<number | undefined> {

    return this.platform.featureOptions.getFloat(option, this.id);
  }

  // Utility function to return an integer configuration parameter on a device.
  public getFeatureNumber(option: string): Nullable<number | undefined> {

    return this.platform.featureOptions.getInteger(option, this.id);
  }

  // Utility for checking feature options on the controller.
  public hasFeature(option: string, device?: AccessControllerConfig | AccessDeviceConfig): boolean {

    // Devices are identified the same way everywhere we scope feature options, so that per-door options on multi-door devices (e.g. UAH-Ent) match.
    const deviceId = (device as AccessDeviceConfig | undefined)?.mac ? deviceIdentifier(device as AccessDeviceConfig) : undefined;

    return this.platform.featureOptions.test(option, deviceId ?? this.id, this.id);
  }

  // Return a unique identifier for an Access controller.
  public get id(): string | undefined {

     
    return this.uda.host?.mac ? normalizeMac(this.uda.host.mac) : undefined;
  }
}
