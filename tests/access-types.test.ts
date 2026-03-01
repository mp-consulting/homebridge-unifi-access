import { describe, expect, it } from 'vitest';
import { AccessEventType, AccessReservedNames } from '../src/access-types.js';

describe('AccessReservedNames enum', () => {

  const reservedNameValues = Object.values(AccessReservedNames);

  it('should have all unique values', () => {

    const uniqueValues = new Set(reservedNameValues);

    expect(uniqueValues.size).toBe(reservedNameValues.length);
  });

  it('should contain only string values', () => {

    for(const value of reservedNameValues) {

      expect(typeof value).toBe('string');
    }
  });

  const expectedMembers: [string, string][] = [

    ['CONTACT_DPS', 'ContactSensor.DPS'],
    ['CONTACT_DPS_SIDE', 'ContactSensor.DPS.Side'],
    ['CONTACT_REL', 'ContactSensor.REL'],
    ['CONTACT_REN', 'ContactSensor.REN'],
    ['CONTACT_REX', 'ContactSensor.REX'],
    ['LOCK_DOOR_SIDE', 'Lock.Door.Side'],
    ['SWITCH_ACCESSMETHOD_FACE', 'AccessMethod.Face'],
    ['SWITCH_ACCESSMETHOD_HAND', 'AccessMethod.Hand'],
    ['SWITCH_ACCESSMETHOD_MOBILE', 'AccessMethod.Mobile'],
    ['SWITCH_ACCESSMETHOD_NFC', 'AccessMethod.NFC'],
    ['SWITCH_ACCESSMETHOD_PIN', 'AccessMethod.PIN'],
    ['SWITCH_ACCESSMETHOD_QR', 'AccessMethod.QR'],
    ['SWITCH_ACCESSMETHOD_TOUCHPASS', 'AccessMethod.TouchPass'],
    ['SWITCH_DOORBELL_TRIGGER', 'DoorbellTrigger'],
    ['SWITCH_LOCK_DOOR_SIDE_TRIGGER', 'Switch.Lock.Door.Side.Trigger'],
    ['SWITCH_LOCK_TRIGGER', 'LockTrigger'],
    ['SWITCH_MOTION_SENSOR', 'MotionSensorSwitch'],
    ['SWITCH_MOTION_TRIGGER', 'MotionSensorTrigger'],
  ];

  it.each(expectedMembers)('should have %s = %s', (key, value) => {

    expect(AccessReservedNames[key as keyof typeof AccessReservedNames]).toBe(value);
  });
});

describe('AccessEventType enum', () => {

  const eventTypeValues = Object.values(AccessEventType);

  it('should have all unique values', () => {

    const uniqueValues = new Set(eventTypeValues);

    expect(uniqueValues.size).toBe(eventTypeValues.length);
  });

  it('should contain only string values', () => {

    for(const value of eventTypeValues) {

      expect(typeof value).toBe('string');
    }
  });

  it("should have all values starting with 'access.'", () => {

    for(const value of eventTypeValues) {

      expect(value.startsWith('access.')).toBe(true);
    }
  });

  const expectedEvents: [string, string][] = [

    ['DEVICE_DELETE', 'access.data.device.delete'],
    ['DEVICE_REMOTE_UNLOCK', 'access.data.device.remote_unlock'],
    ['DEVICE_UPDATE', 'access.data.device.update'],
    ['DEVICE_UPDATE_V2', 'access.data.v2.device.update'],
    ['DOORBELL_CANCEL', 'access.remote_view.change'],
    ['DOORBELL_RING', 'access.remote_view'],
    ['LOCATION_UPDATE', 'access.data.v2.location.update'],
  ];

  it.each(expectedEvents)('should have %s = %s', (key, value) => {

    expect(AccessEventType[key as keyof typeof AccessEventType]).toBe(value);
  });
});
