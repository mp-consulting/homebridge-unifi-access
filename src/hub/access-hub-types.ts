/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * access-hub-types.ts: Types, interfaces, and constants for the UniFi Access hub.
 */
import type { AccessHints } from '../access-device.js';
import { AccessReservedNames } from '../access-types.js';
import type { CharacteristicValue } from 'homebridge';
import type { SensorInput } from '../access-device-catalog.js';

// Access methods available to us for readers.
export const accessMethods = [

  { capability: 'identity_face_unlock', key: 'face', name: 'Face Unlock', option: 'AccessMethod.Face', subtype: AccessReservedNames.SWITCH_ACCESSMETHOD_FACE },
  { capability: 'hand_wave', key: 'wave', name: 'Hand Wave', option: 'AccessMethod.Hand', subtype: AccessReservedNames.SWITCH_ACCESSMETHOD_HAND },
  { capability: [ 'mobile_unlock_ver2', 'support_mobile_unlock' ], configsApiKeys: [ 'bt', 'bt_button', 'bt_tap' ], key: 'bt_button',
    name: 'Mobile', option: 'AccessMethod.Mobile', subtype: AccessReservedNames.SWITCH_ACCESSMETHOD_MOBILE },
  { capability: 'nfc_card_easy_provision', key: 'nfc', name: 'NFC', option: 'AccessMethod.NFC', subtype: AccessReservedNames.SWITCH_ACCESSMETHOD_NFC },
  { capability: 'pin_code', key: 'pin_code', name: 'PIN', option: 'AccessMethod.PIN', subtype: AccessReservedNames.SWITCH_ACCESSMETHOD_PIN },
  { capability: 'qr_code', key: 'qr_code', name: 'QR Code', option: 'AccessMethod.QR', subtype: AccessReservedNames.SWITCH_ACCESSMETHOD_QR },
  { capability: 'support_apple_pass', key: 'apple_pass', name: 'TouchPass', option: 'AccessMethod.TouchPass', subtype: AccessReservedNames.SWITCH_ACCESSMETHOD_TOUCHPASS },
] as const;

// Extract the key property values from the access methods array to create a union type of all possible keys for our supported access methods.
export type AccessMethodKey = typeof accessMethods[number]['key'];

// Access v2 event data so that we can detect access method changes.
export interface AccessEventDeviceUpdateV2 {

  access_method?: {

    [K in AccessMethodKey]?: 'yes' | 'no';
  };

  // Location states for UA Gate hubs which contain the lock state per door.
  location_states?: {

    alarms?: unknown[];
    dps: 'open' | 'close';
    dps_connected: boolean;
    emergency?: Record<string, unknown>;
    enable: boolean;
    hub_gate_door_mode?: string;
    is_unavailable: boolean;
    location_id: string;
    lock: 'locked' | 'unlocked';
    manually_action_button_number?: number;
  }[];
}

// Define the dry contact inputs we're interested in for Access hubs.
export const sensorInputs: readonly SensorInput[] = [ 'Dps', 'Rel', 'Ren', 'Rex' ];

// Create a mapped type of our HomeKit terminal input state check. We exclude hkDpsState since we implement it with a manual getter/setter that
// provides fallback behavior when the DPS contact sensor is disabled.
export type AccessHubHKProps = {

  [K in `hk${SensorInput}State` as K extends 'hkDpsState' ? never : K]: CharacteristicValue;
};

// Create a mapped type of our wiring checks.
export type AccessHubWiredProps = {

  [P in `is${SensorInput}Wired`]: boolean;
};

// Utility to assist us in constructing typing for the properties we will be using.
export type KeyOf<T, Prefix extends string, Suffix extends string = ''> = Extract<keyof T, `${Prefix}${SensorInput}${Suffix}`>;

// Key-union types for AccessHints properties.
export type HasWiringHintKey = KeyOf<AccessHints, 'hasWiring'>;
export type LogHintKey = KeyOf<AccessHints, 'log'>;

// Valid door service types.
export type DoorServiceType = 'Lock' | 'GarageDoorOpener';

// Constants for timing.
export const AUTO_LOCK_DELAY_MS = 5000;
export const GATE_TRANSITION_COOLDOWN_MS = 5000;

// Retrieve a config value by key from the Access device configs array.
export function getConfigValue(configs: { key: string; value: string }[] | undefined, key: string): string | undefined {

  return configs?.find(entry => entry.key === key)?.value;
}

// Check if all wiring keys are active ("on") in the Access device configs.
export function areWiringKeysActive(configs: { key: string; value: string }[] | undefined, wiringKeys: string[]): boolean {

  return wiringKeys.every(wire => configs?.some(e => (e.key === wire) && (e.value === 'on')));
}

// Proxy mode configuration key for UA Ultra devices.
export const REX_BUTTON_MODE_CONFIG_KEY = 'rex_button_mode';

// Terminal input definitions shared by configureTerminalInputs and handleDeviceUpdate.
export const terminalInputs: readonly { input: SensorInput; label: string; topic: string }[] = [

  { input: 'Dps', label: 'Door Position Sensor', topic: 'dps' },
  { input: 'Rel', label: 'Remote Release', topic: 'rel' },
  { input: 'Ren', label: 'Request to Enter Sensor', topic: 'ren' },
  { input: 'Rex', label: 'Request to Exit Sensor', topic: 'rex' },
];

// Location data update event (location metadata/configuration changes).
export interface AccessEventLocationDataUpdate {

  extras?: Record<string, unknown>;
  extra_type?: string;
  full_name?: string;
  level?: number;
  location_type?: string;
  name: string;
  previous_name?: string | string[];
  timezone?: string;
  unique_id: string;
  up_id?: string;
  work_time?: string;
  work_time_id?: string;
}

// Location update event data (v2 API).
export interface AccessEventLocationUpdate {

  device_ids?: string[];
  extras?: Record<string, unknown>;
  id: string;
  last_activity?: number;
  location_type?: string;
  name: string;

  state?: {

    dps: 'open' | 'close';
    dps_connected?: boolean;
    enable?: boolean;
    is_unavailable?: boolean;
    lock: 'locked' | 'unlocked';
  };

  thumbnail?: Record<string, unknown>;
  up_id?: string;
}

// Internal event map for the hub event bus. State setters emit these events and modules subscribe to react.
export interface HubEventMap {

  'lock:changed': { isSideDoor: boolean; value: CharacteristicValue };
  'dps:changed': { isSideDoor: boolean; value: CharacteristicValue };
  'sensor:changed': { input: SensorInput; value: CharacteristicValue };
  'doorbell:ring': { requestId: string };
  'doorbell:cancel': Record<string, never>;
  'device:online': { isOnline: boolean };
}

// Typed event emitter for the hub event bus.
export type HubEventKey = keyof HubEventMap;
