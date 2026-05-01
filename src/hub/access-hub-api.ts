/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-hub-api.ts: Hub API commands and door discovery for the UniFi Access hub.
 */
import {
  UGT_MAIN_DOOR_TARGET_NAME, UGT_MAIN_PORT_SOURCE_ID, UGT_SIDE_DOOR_TARGET_NAME, UGT_SIDE_PORT_SOURCE_ID,
} from '../access-device-catalog.js';
import { AccessReservedNames } from '../access-types.js';
import { AUTO_LOCK_DELAY_MS } from './access-hub-types.js';
import type { AccessHub } from './access-hub.js';
import { normalizeMac } from '../settings.js';
import { toDpsState, toLockState } from './access-hub-utils.js';

// Unified utility function to execute lock and unlock actions on a hub door.
export async function hubDoorLockCommand(hub: AccessHub, isLocking: boolean, isSideDoor = false): Promise<boolean> {

  const action = isLocking ? 'lock' : 'unlock';
  const doorName = isSideDoor ? 'side door' : (hub.catalog.usesLocationApi ? 'gate' : 'door');
  const doorId = isSideDoor ? hub.sideDoorLocationId : hub.mainDoorLocationId;

  // Only allow relocking if we are able to do so. UA Gate is exempt since it's a motorized gate that needs to close. For non-UA Gate hubs, the same restriction
  // applies to both Lock and GarageDoorOpener service types since GarageDoorOpener is just a visual convenience for the same underlying lock behavior.
  if((hub.lockDelayInterval === undefined) && isLocking && !hub.catalog.usesLocationApi) {

    hub.log.error('Unable to manually relock the %s when the lock relay is configured to the default settings.', doorName);

    return false;
  }

  // If we're not online, we're done.
  if(!hub.isOnline) {

    hub.log.error('Unable to %s the %s. Device is offline.', action, doorName);

    return false;
  }

  // For devices using the location API, use the location-based unlock endpoint since the standard device API is not supported.
  if(hub.catalog.usesLocationApi) {

    if(!doorId) {

      hub.log.error('Unable to %s the %s. Door not found.', action, isSideDoor ? 'side door' : 'gate');

      return false;
    }

    // Execute the action using the location endpoint.
    const endpoint = hub.controller.udaApi.getApiEndpoint('location') + '/' + doorId + '/unlock';

    const response = await hub.controller.udaApi.retrieve(endpoint, {

      body: JSON.stringify({}),
      method: 'PUT',
    });

    if(!hub.controller.udaApi.responseOk(response?.statusCode)) {

      hub.log.error('Unable to %s the %s.', action, doorName);

      return false;
    }

    // When unlocking from HomeKit, the controller doesn't send the events to the events API. Manually update the state and schedule the auto-lock.
    if(!isLocking) {

      if(isSideDoor) {

        hub.hkSideDoorLockState = hub.hap.Characteristic.LockCurrentState.UNSECURED;
      } else {

        hub.hkLockState = hub.hap.Characteristic.LockCurrentState.UNSECURED;
      }

      setTimeout(() => {

        if(isSideDoor) {

          hub.hkSideDoorLockState = hub.hap.Characteristic.LockCurrentState.SECURED;
        } else {

          hub.hkLockState = hub.hap.Characteristic.LockCurrentState.SECURED;
        }
      }, AUTO_LOCK_DELAY_MS);
    }

    return true;
  }

  // For hub types other than UA Gate, we use the standard device unlock API. GarageDoorOpener uses the same lock delay interval as Lock service
  // since it's just a visual convenience for the same underlying lock behavior.
  const delayInterval = hub.lockDelayInterval;

  // Execute the action.
  if(!(await hub.controller.udaApi.unlock(hub.uda, (delayInterval === undefined) ? undefined : (isLocking ? 0 : Infinity)))) {

    hub.log.error('Unable to %s.', action);

    return false;
  }

  return true;
}

// Discover main and side door location IDs and names for UA Gate hubs. Has no service dependency and can run early in the boot sequence.
export function discoverDoorNames(hub: AccessHub): void {

  const doors = hub.controller.udaApi.doors ?? [];

  // Collect every port_setting extension. Each entry's target_value is the unique_id of a door physically wired to this hub. source_id (port1/port2)
  // and target_name (door name on newer firmware, or oper1/oper2 on older firmware) help differentiate which relay each door is on.
  const portSettings = hub.uda.extensions?.filter(e => e.extension_name === 'port_setting') ?? [];

  hub.log.debug('Door discovery: %d door(s) in API: %s', doors.length,
    JSON.stringify(doors.map(d => ({ id: d.unique_id, name: d.name, devices: d.device_groups?.map(g => g.mac) ?? [] }))));
  hub.log.debug('Door discovery: hub.mac=%s, hub.uda.door=%s, port_setting extensions=%s', hub.uda.mac,
    JSON.stringify(hub.uda.door ? { id: hub.uda.door.unique_id, name: hub.uda.door.name } : null),
    JSON.stringify(portSettings.map(e => ({ source_id: e.source_id, target_name: e.target_name, target_value: e.target_value }))));

  if(doors.length === 0) {

    hub.log.warn('No doors found in Access API. Door event handling may not work correctly.');

    return;
  }

  // Restrict candidates to doors actually wired to this hub. Two sources, in order of reliability:
  //   1. port_setting extension target_values — the relay/door wiring the controller stores per UA Gate device.
  //   2. door.device_groups containing the hub's MAC — present on some firmware versions.
  // If neither narrows the list, fall back to all doors.
  const wiredDoorIds = new Set(portSettings.map(e => e.target_value).filter((v): v is string => Boolean(v)));
  const hubMac = normalizeMac(hub.uda.mac);
  const wiredDoors = wiredDoorIds.size ? doors.filter(d => wiredDoorIds.has(d.unique_id)) : [];
  const macDoors = wiredDoors.length ? [] : doors.filter(d => d.device_groups?.some(dev => dev.mac && (normalizeMac(dev.mac) === hubMac)));
  const candidates = wiredDoors.length ? wiredDoors : (macDoors.length ? macDoors : doors);

  // Identify side door first so the main door can be deduced by exclusion when needed.
  if(hub.hints.hasSideDoor) {

    // Strategy 1: port_setting extension keyed by source_id 'port2' (oper2 relay).
    const sideExt = portSettings.find(e => (e.source_id === UGT_SIDE_PORT_SOURCE_ID) || (e.target_name === UGT_SIDE_DOOR_TARGET_NAME));

    if(sideExt?.target_value && candidates.some(d => d.unique_id === sideExt.target_value)) {

      hub.sideDoorLocationId = sideExt.target_value;
    } else {

      // Strategy 2: Look for a door named like "side", "portillon", "pedestrian".
      hub.sideDoorLocationId = candidates.find(door => /portillon|side|pedestrian|pieton|wicket|back|secondary/i.test(door.name))?.unique_id;
    }
  }

  // Identify main door from remaining candidates (every hub-bound door except the side door).
  const mainCandidates = candidates.filter(d => d.unique_id !== hub.sideDoorLocationId);

  // Strategy 1: port_setting extension keyed by source_id 'port1' (oper1 relay).
  const mainExt = portSettings.find(e => (e.source_id === UGT_MAIN_PORT_SOURCE_ID) || (e.target_name === UGT_MAIN_DOOR_TARGET_NAME));

  if(mainExt?.target_value && mainCandidates.some(d => d.unique_id === mainExt.target_value)) {

    hub.mainDoorLocationId = mainExt.target_value;
  } else if(mainCandidates.length === 1) {

    // Strategy 2: With the side door identified, the only remaining candidate is the main door.
    hub.mainDoorLocationId = mainCandidates[0].unique_id;
  } else if(mainCandidates.length > 1) {

    // Strategy 3: Look for a door named like "main", "portail", "principal" (excluding side/pedestrian patterns).
    const mainByRegex = mainCandidates.find(door =>
      /portail|main|principal|entry|front|gate/i.test(door.name) && !/portillon|side|pedestrian|pieton|wicket|back/i.test(door.name));

    // Strategy 4: Fall back to the device's bound door reference, but only if it's a valid candidate.
    const boundDoor = hub.uda.door?.unique_id;
    const boundIsCandidate = boundDoor !== undefined && mainCandidates.some(d => d.unique_id === boundDoor);

    // Strategy 5: First candidate.
    hub.mainDoorLocationId = mainByRegex?.unique_id ?? (boundIsCandidate ? boundDoor : mainCandidates[0].unique_id);
  }

  // If we still don't have a side door but had hasSideDoor, deduce from leftover candidate (when there are 2 total).
  if(hub.hints.hasSideDoor && !hub.sideDoorLocationId && (candidates.length === 2)) {

    hub.sideDoorLocationId = candidates.find(d => d.unique_id !== hub.mainDoorLocationId)?.unique_id;
  }

  // Resolve names from the doors list.
  hub.mainDoorName = doors.find(d => d.unique_id === hub.mainDoorLocationId)?.name;
  hub.sideDoorName = hub.hints.hasSideDoor ? doors.find(d => d.unique_id === hub.sideDoorLocationId)?.name : undefined;

  hub.log.info('Discovered main door: %s (id=%s)%s.',
    hub.mainDoorName ?? '(unnamed)', hub.mainDoorLocationId ?? '(none)',
    hub.hints.hasSideDoor ? ', side door: ' + (hub.sideDoorName ?? '(unnamed)') + ' (id=' + (hub.sideDoorLocationId ?? '(none)') + ')' : '');
}

// Initialize door states from the API bootstrap data and propagate names to HomeKit services. Must be called after services are configured.
export function initializeDoorsFromApi(hub: AccessHub): void {

  const doors = hub.controller.udaApi.doors ?? [];

  if(doors.length === 0) {

    return;
  }

  // Initialize door states from the already-loaded doors data.
  initializeDoorsFromBootstrap(hub, doors);

  // Propagate discovered door names to HomeKit services.
  hub.configureInfo();
}

// Initialize door states from the doors data loaded during API bootstrap. This avoids making additional API calls which may fail.
export function initializeDoorsFromBootstrap(
  hub: AccessHub, doors: { unique_id: string; name: string; door_position_status?: string; door_lock_relay_status?: string }[],
): void {

  // Find and initialize main door state.
  if(hub.mainDoorLocationId) {

    const mainDoor = doors.find(d => d.unique_id === hub.mainDoorLocationId);

    if(mainDoor) {

      initializeDoorState(hub, mainDoor, false);
    }
  }

  // Find and initialize side door state.
  if(hub.sideDoorLocationId && hub.hints.hasSideDoor) {

    const sideDoor = doors.find(d => d.unique_id === hub.sideDoorLocationId);

    if(sideDoor) {

      initializeDoorState(hub, sideDoor, true);
    }
  }
}

// Initialize a single door's state from bootstrap data.
export function initializeDoorState(hub: AccessHub, doorData: { door_position_status?: string; door_lock_relay_status?: string }, isSideDoor: boolean): void {

  const newDpsState = toDpsState(hub, (doorData.door_position_status ?? 'close') as 'open' | 'close');
  const newLockState = toLockState(hub, (doorData.door_lock_relay_status ?? 'lock') as 'lock' | 'unlock');

  if(isSideDoor) {

    hub._hkSideDoorDpsState = newDpsState;
    hub._hkSideDoorLockState = newLockState;

    // Update the side door contact sensor service directly since it was already created before door discovery.
    hub.accessory.getServiceById(hub.hap.Service.ContactSensor, AccessReservedNames.CONTACT_DPS_SIDE)
      ?.updateCharacteristic(hub.hap.Characteristic.ContactSensorState, newDpsState);
  } else {

    hub._hkDpsState = newDpsState;
    hub._hkLockState = newLockState;
  }
}
