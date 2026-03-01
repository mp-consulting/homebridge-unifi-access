/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * access-hub-api.ts: Hub API commands and door discovery for the UniFi Access hub.
 */
import { UGT_SIDE_DOOR_TARGET_NAME } from "../access-device-catalog.js";
import { AccessReservedNames } from "../access-types.js";
import { AUTO_LOCK_DELAY_MS } from "./access-hub-types.js";
import type { AccessHub } from "./access-hub.js";
import { toDpsState, toLockState } from "./access-hub-utils.js";

// Unified utility function to execute lock and unlock actions on a hub door.
export async function hubDoorLockCommand(hub: AccessHub, isLocking: boolean, isSideDoor = false): Promise<boolean> {

  const action = isLocking ? "lock" : "unlock";
  const doorName = isSideDoor ? "side door" : (hub.catalog.usesLocationApi ? "gate" : "door");
  const doorId = isSideDoor ? hub.sideDoorLocationId : hub.mainDoorLocationId;

  // Only allow relocking if we are able to do so. UA Gate is exempt since it's a motorized gate that needs to close. For non-UA Gate hubs, the same restriction
  // applies to both Lock and GarageDoorOpener service types since GarageDoorOpener is just a visual convenience for the same underlying lock behavior.
  if((hub.lockDelayInterval === undefined) && isLocking && !hub.catalog.usesLocationApi) {

    hub.log.error("Unable to manually relock the %s when the lock relay is configured to the default settings.", doorName);

    return false;
  }

  // If we're not online, we're done.
  if(!hub.isOnline) {

    hub.log.error("Unable to %s the %s. Device is offline.", action, doorName);

    return false;
  }

  // For devices using the location API, use the location-based unlock endpoint since the standard device API is not supported.
  if(hub.catalog.usesLocationApi) {

    if(!doorId) {

      hub.log.error("Unable to %s the %s. Door not found.", action, isSideDoor ? "side door" : "gate");

      return false;
    }

    // Execute the action using the location endpoint.
    const endpoint = hub.controller.udaApi.getApiEndpoint("location") + "/" + doorId + "/unlock";

    const response = await hub.controller.udaApi.retrieve(endpoint, {

      body: JSON.stringify({}),
      method: "PUT"
    });

    if(!hub.controller.udaApi.responseOk(response?.statusCode)) {

      hub.log.error("Unable to %s the %s.", action, doorName);

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

  // For hub types other than UA Gate, we use the standard device unlock API. GarageDoorOpener uses the same lock delay interval as Lock service since it's just a
  // visual convenience for the same underlying lock behavior.
  const delayInterval = hub.lockDelayInterval;

  // Execute the action.
  if(!(await hub.controller.udaApi.unlock(hub.uda, (delayInterval === undefined) ? undefined : (isLocking ? 0 : Infinity)))) {

    hub.log.error("Unable to %s.", action);

    return false;
  }

  return true;
}

// Discover main and side door location IDs and names for UA Gate hubs. Has no service dependency and can run early in the boot sequence.
export function discoverDoorNames(hub: AccessHub): void {

  const doors = hub.controller.udaApi.doors ?? [];

  if(doors.length === 0) {

    hub.log.warn("No doors found in Access API. Door event handling may not work correctly.");

    return;
  }

  // Get the primary door ID from device config (may be undefined).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const primaryDoorId = hub.uda.door?.unique_id;

  // Strategy 1: Use the device's bound door as main door.
  if(primaryDoorId) {

    hub.mainDoorLocationId = primaryDoorId;
  } else if(doors.length >= 1) {

    // Strategy 2: Look for a door named like "main", "gate", "portail" (but not side/pedestrian).
    const mainDoor = doors.find(door => /portail|main|gate|principal|entry|front/i.test(door.name) && !/portillon|side|pedestrian|pieton|wicket|back/i.test(door.name));

    // Strategy 3: Use the first door as main door.
    hub.mainDoorLocationId = mainDoor?.unique_id ?? doors[0].unique_id;
  }

  // Store the main door name for HomeKit service naming.
  hub.mainDoorName = doors.find(d => d.unique_id === hub.mainDoorLocationId)?.name;

  // Find the side door (if enabled).
  if(hub.hints.hasSideDoor) {

    // Strategy 1: Check extensions for oper2 port setting.
    const sideDoorFromExt = hub.uda.extensions?.find(ext => (ext.extension_name === "port_setting") && (ext.target_name === UGT_SIDE_DOOR_TARGET_NAME))?.target_value;

    if(sideDoorFromExt) {

      hub.sideDoorLocationId = sideDoorFromExt;
    } else {

      // Strategy 2: Look for a door named like "side", "portillon", "pedestrian".
      const sideDoor = doors.find(door => (door.unique_id !== hub.mainDoorLocationId) && /portillon|side|pedestrian|pieton|wicket|back|secondary/i.test(door.name));

      if(sideDoor) {

        hub.sideDoorLocationId = sideDoor.unique_id;
      } else if(doors.length === 2) {

        // Strategy 3: If we have exactly 2 doors, the other one is the side door.
        const otherDoor = doors.find(door => door.unique_id !== hub.mainDoorLocationId);

        hub.sideDoorLocationId = otherDoor?.unique_id;
      }
    }

    // Store the side door name for HomeKit service naming.
    hub.sideDoorName = doors.find(d => d.unique_id === hub.sideDoorLocationId)?.name;
  }
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
export function initializeDoorsFromBootstrap(hub: AccessHub, doors: { unique_id: string; name: string; door_position_status?: string; door_lock_relay_status?: string }[]): void {

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

  const newDpsState = toDpsState(hub, (doorData.door_position_status ?? "close") as "open" | "close");
  const newLockState = toLockState(hub, (doorData.door_lock_relay_status ?? "lock") as "lock" | "unlock");

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
