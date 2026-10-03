/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * lib-service.test.ts: Tests for the HomeKit service helpers, exercised against real HAP-NodeJS services.
 */
import { Accessory, Characteristic, Service, uuid } from '@homebridge/hap-nodejs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireService, getServiceName, setServiceName, validService } from '../src/lib/service.js';
import type { PlatformAccessory } from 'homebridge';

// HAP's Accessory exposes the same service management API that our helpers rely on from PlatformAccessory.
function createAccessory(): PlatformAccessory {

  return new Accessory('Test Hub', uuid.generate('test-hub')) as unknown as PlatformAccessory;
}

describe('acquireService', () => {

  let accessory: PlatformAccessory;

  beforeEach(() => {

    accessory = createAccessory();
  });

  it('creates and names a new service, running the creation callback once', () => {

    const onCreate = vi.fn();
    const first = acquireService(accessory, Service.ContactSensor, 'Front Door Sensor', 'dps', onCreate);
    const second = acquireService(accessory, Service.ContactSensor, 'Front Door Sensor', 'dps', onCreate);

    expect(second).toBe(first);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(first);
    expect(first?.displayName).toBe('Front Door Sensor');
    expect(first?.getCharacteristic(Characteristic.ConfiguredName).value).toBe('Front Door Sensor');
    expect(first?.getCharacteristic(Characteristic.Name).value).toBe('Front Door Sensor');
  });

  it('keeps services with different subtypes apart', () => {

    const main = acquireService(accessory, Service.Switch, 'Main Trigger', 'main');
    const side = acquireService(accessory, Service.Switch, 'Side Trigger', 'side');

    expect(main).not.toBe(side);
    expect(accessory.getServiceById(Service.Switch, 'side')).toBe(side);
  });

  it('only adds ConfiguredName to services that support it', () => {

    const lock = acquireService(accessory, Service.LockMechanism, 'Front Door');
    const sensor = acquireService(accessory, Service.ContactSensor, 'Front Door Sensor');

    expect(lock?.optionalCharacteristics.some(x => x.UUID === Characteristic.ConfiguredName.UUID)).toBe(false);
    expect(lock?.testCharacteristic(Characteristic.ConfiguredName)).toBe(false);
    expect(sensor?.optionalCharacteristics.filter(x => x.UUID === Characteristic.ConfiguredName.UUID)).toHaveLength(1);
  });

  it('sanitizes names for HomeKit', () => {

    expect(acquireService(accessory, Service.Switch, '🚪 Front Door #1', 'trigger')?.displayName).toBe('Front Door 1');
  });
});

describe('validService', () => {

  let accessory: PlatformAccessory;

  beforeEach(() => {

    accessory = createAccessory();
    acquireService(accessory, Service.ContactSensor, 'Door Sensor', 'dps');
  });

  it('keeps a service that passes validation', () => {

    expect(validService(accessory, Service.ContactSensor, true, 'dps')).toBe(true);
    expect(accessory.getServiceById(Service.ContactSensor, 'dps')).toBeDefined();
  });

  it('removes a service that fails validation', () => {

    expect(validService(accessory, Service.ContactSensor, false, 'dps')).toBe(false);
    expect(accessory.getServiceById(Service.ContactSensor, 'dps')).toBeUndefined();
  });

  it('passes whether the service exists to a validation function', () => {

    const validate = vi.fn().mockReturnValue(true);

    validService(accessory, Service.ContactSensor, validate, 'dps');
    validService(accessory, Service.ContactSensor, validate, 'rex');

    expect(validate.mock.calls).toEqual([ [ true ], [ false ] ]);
  });
});

describe('service names', () => {

  it('updates every name characteristic the service supports and reads back the configured name', () => {

    const accessory = createAccessory();
    const service = acquireService(accessory, Service.Switch, 'Old Name', 'trigger') as Service;

    setServiceName(service, 'New Name!');

    expect(service.displayName).toBe('New Name');
    expect(service.getCharacteristic(Characteristic.ConfiguredName).value).toBe('New Name');
    expect(service.getCharacteristic(Characteristic.Name).value).toBe('New Name');
    expect(getServiceName(service)).toBe('New Name');
    expect(getServiceName(undefined)).toBeUndefined();
  });
});
