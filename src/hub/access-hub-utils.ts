/* Copyright(C) 2019-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * access-hub-utils.ts: Pure utility functions for the UniFi Access hub.
 */
import type { CharacteristicValue } from "homebridge";
import type { SensorInput } from "../access-device-catalog.js";
import { AccessReservedNames } from "../access-types.js";
import { areWiringKeysActive, type DoorServiceType, getConfigValue, type HasWiringHintKey } from "./access-hub-types.js";
import type { AccessHub } from "./access-hub.js";

// Convert lock string value to HomeKit LockCurrentState.
export function toLockState(hub: AccessHub, lockValue: "locked" | "unlocked" | "lock" | "unlock"): CharacteristicValue {

  return [ "unlock", "unlocked" ].includes(lockValue) ? hub.hap.Characteristic.LockCurrentState.UNSECURED : hub.hap.Characteristic.LockCurrentState.SECURED;
}

// Convert DPS string value to HomeKit ContactSensorState.
export function toDpsState(hub: AccessHub, dpsValue: "open" | "close"): CharacteristicValue {

  return dpsValue === "open" ? hub.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
}

// Check if a lock state represents "locked".
export function isLocked(hub: AccessHub, state: CharacteristicValue): boolean {

  return state === hub.hap.Characteristic.LockCurrentState.SECURED;
}

// Check if a DPS state represents "closed" (contact detected).
export function isClosed(hub: AccessHub, state: CharacteristicValue): boolean {

  return state === hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
}

// Return the door service type from configuration. UA Gate devices default to GarageDoorOpener and can be overridden to Lock. Other hubs default to Lock and can be
// overridden to GarageDoorOpener.
export function doorServiceType(hub: AccessHub): DoorServiceType {

  if(hub.catalog.defaultDoorService === "GarageDoorOpener") {

    return hub.hasFeature("Hub.Door.UseLock") ? "Lock" : "GarageDoorOpener";
  }

  return hub.hasFeature("Hub.Door.UseGarageOpener") ? "GarageDoorOpener" : "Lock";
}

// Utility to validate hub capabilities.
export function hasCapability(hub: AccessHub, capability: string | readonly string[]): boolean {

  return Array.isArray(capability) ? capability.some(c => hub.uda.capabilities.includes(c)) : hub.uda.capabilities.includes(capability as string);
}

// Utility to check the wiring state of a given terminal input.
export function isWired(hub: AccessHub, input: SensorInput): boolean {

  const sensorConfig = hub.catalog.sensors[input];

  if(!sensorConfig) {

    return false;
  }

  // Proxy mode devices use extension config instead of wiring keys.
  if(sensorConfig.proxyMode) {

    return hub.uda.extensions?.[0]?.target_config?.some(e => (e.config_key === "rex_button_mode") && (e.config_value === sensorConfig.proxyMode)) ?? false;
  }

  if(!sensorConfig.wiringKeys) {

    return false;
  }

  return areWiringKeysActive(hub.uda.configs, sensorConfig.wiringKeys);
}

// Return the wiring state of the side door DPS.
export function isSideDoorDpsWired(hub: AccessHub): boolean {

  const wiringKeys = hub.catalog.sideDoor?.dpsWiringKeys;

  if(!wiringKeys) {

    return false;
  }

  return areWiringKeysActive(hub.uda.configs, wiringKeys);
}

// Check and validate proxy mode inputs with what the user has configured in HomeKit.
export function checkUltraInputs(hub: AccessHub): void {

  for(const input of [ "Dps", "Rex" ] as const) {

    const hint = ("hasWiring" + input) as HasWiringHintKey;
    const sensorConfig = hub.catalog.sensors[input];

    if(!sensorConfig?.proxyMode) {

      continue;
    }

    // Is the mode enabled on the hub?
    const isEnabled = hub.uda.extensions?.[0]?.target_config
      ?.some(entry => (entry.config_key === "rex_button_mode") && (entry.config_value === sensorConfig.proxyMode));

    if(hub.hints[hint] && !isEnabled) {

      // The hub has disabled this input.
      hub.hints[hint] = false;
    } else if(!hub.hints[hint] && isEnabled && hub.hasFeature("Hub." + input.toUpperCase())) {

      // The hub has the input enabled, and we want it enabled in HomeKit.
      hub.hints[hint] = true;
    }
  }
}

// Return the current state of a terminal input sensor on the hub. Checks wiring first and returns CONTACT_DETECTED if not wired.
export function hubInputState(hub: AccessHub, input: SensorInput): CharacteristicValue {

  if(!isWired(hub, input)) {

    return hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  const configKey = hub.catalog.sensors[input]?.configKey;

  if(!configKey) {

    return hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  return (getConfigValue(hub.uda.configs, configKey) === "on") ? hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED :
    hub.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
}

// Return the current state of the DPS on the hub.
export function hubDpsState(hub: AccessHub): CharacteristicValue {

  return hubInputState(hub, "Dps");
}

// Return the current state of the side door DPS on the hub.
export function hubSideDoorDpsState(hub: AccessHub): CharacteristicValue {

  if(!isSideDoorDpsWired(hub)) {

    return hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  const configKey = hub.catalog.sideDoor?.dpsConfigKey;

  if(!configKey) {

    return hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  return (getConfigValue(hub.uda.configs, configKey) === "on") ? hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED :
    hub.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
}

// Return the current state of the relay lock on the hub.
export function hubLockState(hub: AccessHub): CharacteristicValue {

  const lockRelayValue = getConfigValue(hub.uda.configs, hub.catalog.lockRelayConfigKey);

  return (lockRelayValue === "off") ? hub.hap.Characteristic.LockCurrentState.SECURED : hub.hap.Characteristic.LockCurrentState.UNSECURED;
}

// Return the current state of the side door relay lock on the hub.
export function hubSideDoorLockState(hub: AccessHub): CharacteristicValue {

  const sideDoorLockKey = hub.catalog.sideDoor?.lockRelayConfigKey;

  if(!sideDoorLockKey) {

    return hub.hap.Characteristic.LockCurrentState.SECURED;
  }

  const lockRelayValue = getConfigValue(hub.uda.configs, sideDoorLockKey);

  return (lockRelayValue === "off") ? hub.hap.Characteristic.LockCurrentState.SECURED : hub.hap.Characteristic.LockCurrentState.UNSECURED;
}

// Utility to retrieve a contact sensor state.
export function getContactSensorState(hub: AccessHub, name: AccessReservedNames): CharacteristicValue {

  return hub.accessory.getServiceById(hub.hap.Service.ContactSensor, name)?.getCharacteristic(hub.hap.Characteristic.ContactSensorState).value ??
    hub.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
}

// Utility to set a contact sensor state.
export function setContactSensorState(hub: AccessHub, name: AccessReservedNames, value: CharacteristicValue): void {

  hub.accessory.getServiceById(hub.hap.Service.ContactSensor, name)?.updateCharacteristic(hub.hap.Characteristic.ContactSensorState, value);
}

// Log the lock delay interval configuration for a door.
export function logLockDelayInterval(hub: AccessHub, doorLabel: string): void {

  if(hub.lockDelayInterval === undefined) {

    hub.log.info("The %s lock relay will lock five seconds after unlocking in HomeKit.", doorLabel);
  } else {

    hub.log.info("The %s lock relay will remain unlocked %s after unlocking in HomeKit.", doorLabel,
      hub.lockDelayInterval === 0 ? "indefinitely" : "for " + hub.lockDelayInterval.toString() + " minutes");
  }
}
