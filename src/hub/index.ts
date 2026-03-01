/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * hub/index.ts: Barrel export for the UniFi Access hub module.
 */
export { AccessHub } from './access-hub.js';
export type { HkStateKey } from './access-hub.js';
export {
  AUTO_LOCK_DELAY_MS, GATE_TRANSITION_COOLDOWN_MS, REX_BUTTON_MODE_CONFIG_KEY, areWiringKeysActive, getConfigValue, accessMethods, sensorInputs, terminalInputs,
} from './access-hub-types.js';
export type {
  AccessEventDeviceUpdateV2, AccessEventLocationUpdate, AccessHubHKProps, AccessHubWiredProps, AccessMethodKey, DoorServiceType, HasWiringHintKey,
  HubEventKey, HubEventMap, KeyOf, LogHintKey,
} from './access-hub-types.js';
