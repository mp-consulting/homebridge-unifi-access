/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-device.ts: Base class for all UniFi Access devices.
 */
import { createPrefixedLogger, normalizeMac } from './settings.js';
import type { API, HAP, PlatformAccessory } from 'homebridge';
import type { AccessApi, AccessDeviceConfig, AccessEventPacket } from './unifi/index.js';
import { type HomebridgePluginLogging, type Nullable, sanitizeName } from './lib/index.js';
import type { AccessController } from './access-controller.js';
import type { AccessPlatform } from './access-platform.js';
import { AccessReservedNames } from './access-types.js';
import { deviceIdentifier } from './access-device-catalog.js';

// Pre-computed set for fast reserved name lookups.
const reservedNameSet = new Set(Object.values(AccessReservedNames).map(x => x.toUpperCase()));

// Device-specific options and settings.
export interface AccessHints {

  enabled: boolean;
  hasSideDoor: boolean;
  hasWiringDps: boolean;
  hasWiringRel: boolean;
  hasWiringRen: boolean;
  hasWiringRex: boolean;
  hasWiringSideDoorDps: boolean;
  logDoorbell: boolean;
  logDps: boolean;
  logLock: boolean;
  logRel: boolean;
  logRen: boolean;
  logRex: boolean;
  separateAccessMethods: boolean;
  separateDoorbell: boolean;
  separateSensors: boolean;
  syncName: boolean;
}

export abstract class AccessBase {

  public readonly api: API;
  public readonly hap: HAP;
  public readonly log: HomebridgePluginLogging;
  public readonly controller: AccessController;
  public udaApi: AccessApi;
  public readonly platform: AccessPlatform;

  // The constructor initializes key variables and calls configureDevice().
  constructor(controller: AccessController) {

    this.api = controller.platform.api;
    this.hap = this.api.hap;
    this.controller = controller;
    this.udaApi = controller.udaApi;
    this.platform = controller.platform;
    this.log = createPrefixedLogger(controller.platform.log, controller.platform.debug.bind(controller.platform), () => this.name);
  }

  // Configure the device information for HomeKit.
  protected setInfo(accessory: PlatformAccessory, device: AccessDeviceConfig): boolean {

    // Update the manufacturer information for this device.
    accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Manufacturer, 'Ubiquiti Inc.');

    // Update the model information for this device.
    const deviceModel = device.display_model ?? device.model;

    if(deviceModel) {

      accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Model, deviceModel);
    }

    // Update the serial number for this device.
    if(device.mac) {

      accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.SerialNumber, normalizeMac(device.mac));
    }

    // Update the firmware revision for this device.
    if(device.firmware) {

      // Capture the version of the device firmware, ensuring we get major, minor, and patch levels if they exist.
      const versionRegex = /^v(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(.+))?$/;
      const match: Nullable<(string | undefined)[]> = versionRegex.exec(device.firmware);

      // Update our firmware revision.
      accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.FirmwareRevision,
        match ? match[1] + '.' + (match[2] ?? '0') + '.' + (match[3] ?? '0') : device.firmware);
    }

    return true;
  }

  // Utility function to return the fully enumerated name of this device.
  public get name(): string {

    return this.controller.udaApi.name;
  }
}

export abstract class AccessDevice extends AccessBase {

  public accessory!: PlatformAccessory;
  public hints: AccessHints;
  public listeners: Record<string, (packet: AccessEventPacket) => void>;
  public abstract uda: AccessDeviceConfig;

  // The constructor initializes key variables and calls configureDevice().
  constructor(controller: AccessController, accessory: PlatformAccessory) {

    // Call the constructor of our base class.
    super(controller);

    this.hints = {} as AccessHints;
    this.listeners = {};

    // Set the accessory.
    this.accessory = accessory;
  }

  // Configure device-specific settings.
  protected configureHints(): boolean {

    this.hints.enabled = this.hasFeature('Device');
    this.hints.syncName = this.hasFeature('Device.SyncName');

    // Inform the user if we've opted for something other than the defaults.
    if(!this.hints.syncName) {

      this.log.info('Device name synchronization with HomeKit is disabled.');
    }

    return true;
  }

  // Configure the device information details for HomeKit.
  public configureInfo(): boolean {

    // Sync the Access name with HomeKit, if configured.
    if(this.hints.syncName && this.uda.alias) {

      this.accessoryName = this.uda.alias;
    }

    this.refreshChildInfo();

    return this.setInfo(this.accessory, this.uda);
  }

  // Keep the accessory information on our child accessories - model, firmware revision, and the like - in step with the device they belong to.
  protected refreshChildInfo(): void {

    for(const accessory of this.childAccessories) {

      this.configureChildInfo(accessory, accessory.context.childSubtype as string, accessory.displayName);
    }
  }

  // Configure the accessory information for a child accessory we've split off from this device, giving it a name and serial number of its own so that HomeKit
  // treats it as a distinct piece of hardware rather than a duplicate of its parent.
  public configureChildInfo(accessory: PlatformAccessory, subtype: string, name: string): void {

    this.setInfo(accessory, this.uda);

    const info = accessory.getService(this.hap.Service.AccessoryInformation);

    info?.updateCharacteristic(this.hap.Characteristic.Name, sanitizeName(name));
    info?.updateCharacteristic(this.hap.Characteristic.SerialNumber, normalizeMac(this.uda.mac) + '-' + subtype);
  }

  // Cleanup our event handlers and any other activities as needed.
  public cleanup(): void {

    for(const eventName of Object.keys(this.listeners)) {

      try {

        this.controller.events.removeListener(eventName, this.listeners[eventName]);
      } catch(error) {

        this.log.debug('Failed to remove event listener for %s: %s', eventName, error);
      }

      delete this.listeners[eventName];
    }
  }

  // Utility function to return a floating point configuration parameter on a device.
  public getFeatureFloat(option: string): Nullable<number | undefined> {

    return this.platform.featureOptions.getFloat(option, this.id, this.controller.id);
  }

  // Utility function to return an integer configuration parameter on a device.
  public getFeatureNumber(option: string): Nullable<number | undefined> {

    return this.platform.featureOptions.getInteger(option, this.id, this.controller.id);
  }

  // Utility function to return a configuration parameter on a device.
  public getFeatureValue(option: string): Nullable<string | undefined> {

    return this.platform.featureOptions.value(option, this.id, this.controller.id);
  }

  // Utility for checking feature options on a device.
  public hasFeature(option: string): boolean {

    return this.controller.hasFeature(option, this.uda);
  }

  // Utility function for reserved identifiers for switches.
  public isReservedName(name: string | undefined): boolean {

    return name === undefined ? false : reservedNameSet.has(name.toUpperCase());
  }

  // Utility function to determine whether or not a device is currently online.
  public get isOnline(): boolean {

    return ([ 'is_adopted', 'is_connected', 'is_managed', 'is_online' ] as const).every(key => this.uda[key]);
  }

  // Return a unique identifier for an Access device.
  public get id(): string {

    return deviceIdentifier(this.uda);
  }

  // Utility function to return the fully enumerated name of this device.
  public get name(): string {

    return this.controller.udaApi.getFullName(this.uda);
  }

  // The accessories this device has split out onto their own HomeKit tiles. Subclasses that use child accessories override this so that name synchronization
  // reaches them.
  public get childAccessories(): PlatformAccessory[] {

    return [];
  }

  // Utility function to return the name that configureInfo would sync to. Subclasses may override to use a different source (e.g., door name).
  public get resolvedName(): string | undefined {

    return this.uda.alias;
  }

  // Utility function to return the current accessory name of this device.
  public get accessoryName(): string {

    return (this.accessory.getService(this.hap.Service.AccessoryInformation)?.getCharacteristic(this.hap.Characteristic.Name).value as string | undefined) ??
      (this.uda.alias ?? 'Unknown');
  }

  // Utility function to set the current accessory name of this device.
  public set accessoryName(name: string) {

    const cleanedName = sanitizeName(name);
    const oldName = this.accessoryName;

    // Set all the internally managed names within Homebridge to the new accessory name.
    this.accessory.displayName = cleanedName;
    this.accessory._associatedHAPAccessory.displayName = cleanedName;

    // Set all the HomeKit-visible names.
    this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Name, cleanedName);

    // Derive a new name by swapping out the old accessory name prefix, or undefined if the name isn't ours to rename.
    const rename = (current: string): string | undefined => (oldName.length && current.startsWith(oldName)) ? cleanedName + current.slice(oldName.length) :
      undefined;

    // Propagate the new name to all our services, including those living on child accessories.
    for(const accessory of [ this.accessory, ...this.childAccessories ]) {

      // Child accessories are named after the service they host, so they get the same prefix substitution their services do.
      if(accessory !== this.accessory) {

        const newAccessoryName = rename(accessory.displayName);

        if(newAccessoryName) {

          accessory.displayName = newAccessoryName;
          accessory._associatedHAPAccessory.displayName = newAccessoryName;
          accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Name, newAccessoryName);
        }
      }

      for(const service of accessory.services) {

        if(service.UUID === this.hap.Service.AccessoryInformation.UUID) {

          continue;
        }

        const newServiceName = rename(service.displayName);

        if(!newServiceName) {

          continue;
        }

        service.displayName = newServiceName;
        service.updateCharacteristic(this.hap.Characteristic.Name, newServiceName);

        if(service.testCharacteristic(this.hap.Characteristic.ConfiguredName)) {

          service.updateCharacteristic(this.hap.Characteristic.ConfiguredName, newServiceName);
        }
      }
    }
  }
}
