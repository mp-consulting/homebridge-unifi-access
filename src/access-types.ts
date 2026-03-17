/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-types.ts: Interface and type definitions for UniFi Access.
 */

// HBUA reserved names.
export enum AccessReservedNames {

  // Manage our contact sensor types.
  CONTACT_DPS = 'ContactSensor.DPS',
  CONTACT_DPS_SIDE = 'ContactSensor.DPS.Side',
  CONTACT_REL = 'ContactSensor.REL',
  CONTACT_REN = 'ContactSensor.REN',
  CONTACT_REX = 'ContactSensor.REX',

  // Manage our door/lock types.
  LOCK_DOOR_SIDE = 'Lock.Door.Side',

  // Manage our switch types.
  SWITCH_ACCESSMETHOD_FACE = 'AccessMethod.Face',
  SWITCH_ACCESSMETHOD_HAND = 'AccessMethod.Hand',
  SWITCH_ACCESSMETHOD_MOBILE = 'AccessMethod.Mobile',
  SWITCH_ACCESSMETHOD_NFC = 'AccessMethod.NFC',
  SWITCH_ACCESSMETHOD_PIN = 'AccessMethod.PIN',
  SWITCH_ACCESSMETHOD_QR = 'AccessMethod.QR',
  SWITCH_ACCESSMETHOD_TOUCHPASS = 'AccessMethod.TouchPass',
  SWITCH_DOORBELL_TRIGGER = 'DoorbellTrigger',
  SWITCH_LOCK_DOOR_SIDE_TRIGGER = 'Switch.Lock.Door.Side.Trigger',
  SWITCH_LOCK_TRIGGER = 'LockTrigger',
  SWITCH_MOTION_SENSOR = 'MotionSensorSwitch',
  SWITCH_MOTION_TRIGGER = 'MotionSensorTrigger'
}

// UniFi Access event type strings from the Access controller API.
export enum AccessEventType {

  DEVICE_DELETE = 'access.data.device.delete',
  DEVICE_REMOTE_UNLOCK = 'access.data.device.remote_unlock',
  DEVICE_UPDATE = 'access.data.device.update',
  DEVICE_UPDATE_V2 = 'access.data.v2.device.update',
  DOORBELL_CANCEL = 'access.remote_view.change',
  DOORBELL_RING = 'access.remote_view',
  LOCATION_DATA_UPDATE = 'access.data.location.update',
  LOCATION_UPDATE = 'access.data.v2.location.update'
}
