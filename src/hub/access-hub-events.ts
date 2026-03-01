/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * access-hub-events.ts: External event parsing for the UniFi Access hub. Parses UniFi Access API events and updates hub state.
 * MQTT publishing and logging are handled automatically by the hub event bus subscribers.
 */
import type { AccessDeviceConfig, AccessEventDoorbellCancel, AccessEventDoorbellRing, AccessEventPacket } from 'unifi-access';
import { AccessEventType } from '../access-types.js';
import {
  AUTO_LOCK_DELAY_MS, type AccessEventDeviceUpdateV2, type AccessEventLocationUpdate, type AccessMethodKey, type HasWiringHintKey,
  accessMethods, terminalInputs,
} from './access-hub-types.js';
import { UGT_MAIN_PORT_SOURCE_ID, UGT_SIDE_PORT_SOURCE_ID } from '../access-device-catalog.js';
import type { AccessHub, HkStateKey } from './access-hub.js';
import { configureTerminalInputs, updateSideDoorServiceNames } from './access-hub-services.js';
import {
  checkUltraInputs, hasCapability, hubDpsState, hubInputState, hubLockState, toDpsState, toLockState,
} from './access-hub-utils.js';

// Register external event handlers on the controller's event emitter. This is the entry point for all UniFi Access API events.
export function registerEventHandlers(hub: AccessHub): void {

  const boundHandler = (packet: AccessEventPacket): void => eventHandler(hub, packet);

  hub.controller.events.on(hub.uda.unique_id, hub.listeners[hub.uda.unique_id] = boundHandler);
  hub.controller.events.on(AccessEventType.DOORBELL_RING, hub.listeners[AccessEventType.DOORBELL_RING] = boundHandler);
  hub.controller.events.on(AccessEventType.DOORBELL_CANCEL, hub.listeners[AccessEventType.DOORBELL_CANCEL] = boundHandler);

  // For devices using the location API, subscribe to door-specific events.
  if(hub.catalog.usesLocationApi) {

    if(hub.mainDoorLocationId) {

      hub.controller.events.on(hub.mainDoorLocationId, hub.listeners[hub.mainDoorLocationId] = boundHandler);
    }

    if(hub.sideDoorLocationId) {

      hub.controller.events.on(hub.sideDoorLocationId, hub.listeners[hub.sideDoorLocationId] = boundHandler);
    }
  }
}

// Top-level event dispatcher.
function eventHandler(hub: AccessHub, packet: AccessEventPacket): void {

  switch(packet.event) {

    case AccessEventType.DEVICE_REMOTE_UNLOCK:

      handleRemoteUnlock(hub, packet);

      break;

    case AccessEventType.DEVICE_UPDATE:

      handleDeviceUpdate(hub, packet);

      break;

    case AccessEventType.DEVICE_UPDATE_V2:

      handleDeviceUpdateV2(hub, packet);

      break;

    case AccessEventType.LOCATION_UPDATE:

      handleLocationUpdate(hub, packet);

      break;

    case AccessEventType.DOORBELL_RING:

      handleDoorbellRing(hub, packet);

      break;

    case AccessEventType.DOORBELL_CANCEL:

      handleDoorbellCancel(hub, packet);

      break;

    default:

      break;
  }
}

// Handle remote unlock events.
function handleRemoteUnlock(hub: AccessHub, packet: AccessEventPacket): void {

  // For UA Gate hubs, determine which door was unlocked based on the event_object_id.
  if(hub.catalog.usesLocationApi) {

    const eventDoorId = packet.event_object_id;
    const isSideDoor = hub.sideDoorLocationId && (eventDoorId === hub.sideDoorLocationId);
    const isMainDoor = hub.mainDoorLocationId && (eventDoorId === hub.mainDoorLocationId);

    if(!isSideDoor && !isMainDoor) {

      return;
    }

    // Set unlocked state. The hub event bus will handle MQTT publishing and logging.
    if(isSideDoor) {

      hub.hkSideDoorLockState = hub.hap.Characteristic.LockCurrentState.UNSECURED;
    } else {

      hub.hkLockState = hub.hap.Characteristic.LockCurrentState.UNSECURED;
    }

    // Auto-lock after delay.
    setTimeout(() => {

      if(isSideDoor) {

        hub.hkSideDoorLockState = hub.hap.Characteristic.LockCurrentState.SECURED;
      } else {

        hub.hkLockState = hub.hap.Characteristic.LockCurrentState.SECURED;
      }
    }, AUTO_LOCK_DELAY_MS);

  } else {

    // Non-UA Gate hubs: default behavior.
    hub.hkLockState = hub.hap.Characteristic.LockCurrentState.UNSECURED;
  }
}

// Handle device update events (v1 API).
function handleDeviceUpdate(hub: AccessHub, packet: AccessEventPacket): void {

  // Process a lock update event if our state has changed. Skip for UA Gate hubs since we handle state manually.
  if(!hub.catalog.skipsV1LockEvents && (hubLockState(hub) !== hub._hkLockState)) {

    hub.hkLockState = hubLockState(hub);
  }

  // Process a side door lock update event if our state has changed (UA Gate only).
  if(hub.hints.hasSideDoor && !hub.catalog.skipsV1LockEvents) {

    const newHubState = hubLockState(hub, true);

    if(newHubState !== hub._hkSideDoorLockState) {

      hub.hkSideDoorLockState = newHubState;
    }
  }

  // Process a side door DPS update event if our state has changed (UA Gate only).
  if(hub.hints.hasSideDoor && hub.hints.hasWiringDps && !hub.catalog.skipsV1LockEvents) {

    const newSideDoorDpsState = hubDpsState(hub, true);

    if(newSideDoorDpsState !== hub._hkSideDoorDpsState) {

      hub._hkSideDoorDpsState = newSideDoorDpsState;
      hub.hubEvents.emit('dps:changed', { isSideDoor: true, value: newSideDoorDpsState });
    }
  }

  // Process any terminal input update events if our state has changed.
  for(const { input } of terminalInputs) {

    const hasKey = ('hasWiring' + input) as HasWiringHintKey;
    const hkKey = ('hk' + input + 'State') as HkStateKey;
    const newState = hubInputState(hub, input);

    if(hub.hints[hasKey] && (newState !== hub[hkKey])) {

      // Setting via the dynamic property triggers the appropriate event emission:
      // - For Dps: the hkDpsState setter emits "dps:changed" + "sensor:changed"
      // - For Rel/Ren/Rex: the dynamic setter emits "sensor:changed"
      hub[hkKey] = newState;
    }
  }

  // Process any changes to terminal input configuration.
  if((packet.data as AccessDeviceConfig).extensions?.[0]?.target_config && hub.catalog.usesProxyMode) {

    checkUltraInputs(hub);
    configureTerminalInputs(hub);
  }

  // Process any changes to our online status.
  if((packet.data as AccessDeviceConfig).is_online !== undefined) {

    hub.hubEvents.emit('device:online', { isOnline: !!(packet.data as AccessDeviceConfig).is_online });
  }
}

// Handle device update v2 events.
function handleDeviceUpdateV2(hub: AccessHub, packet: AccessEventPacket): void {

  const data = packet.data as AccessEventDeviceUpdateV2;

  // Process access method updates.
  if(data.access_method) {

    for(const [ key, value ] of Object.entries(data.access_method) as [AccessMethodKey, string][]) {

      if((value !== 'yes') && (value !== 'no')) {

        continue;
      }

      const accessMethod = accessMethods.find(entry => entry.key === key);

      if(accessMethod) {

        hub.accessory.getServiceById(hub.hap.Service.Switch, accessMethod.subtype)?.updateCharacteristic(hub.hap.Characteristic.On, value === 'yes');
      }
    }
  }

  // Process location_states for UA Gate hubs - this contains lock state per door. Skip during gate transition since the controller sends
  // noisy/unreliable state for both doors in the same event while the gate is moving.
  if(data.location_states && hub.catalog.usesLocationApi && (Date.now() >= hub.gateTransitionUntil) && (Date.now() >= hub.sideDoorGateTransitionUntil)) {

    const locationStates = data.location_states;

    // Process main door state.
    const mainDoorExtension = hub.uda.extensions?.find(ext => ext.source_id === UGT_MAIN_PORT_SOURCE_ID);
    const mainDoorId = mainDoorExtension?.target_value ?? hub.mainDoorLocationId;

    if(mainDoorId) {

      const mainDoorState = locationStates.find(state => state.location_id === mainDoorId);

      if(mainDoorState) {

        updateDoorFromLocationState(hub, mainDoorState, false);
      }
    }

    // Process side door state.
    if(hub.hints.hasSideDoor) {

      const sideDoorExtension = hub.uda.extensions?.find(ext => ext.source_id === UGT_SIDE_PORT_SOURCE_ID);
      const sideDoorId = sideDoorExtension?.target_value ?? hub.sideDoorLocationId;

      if(sideDoorId) {

        const sideDoorState = locationStates.find(state => state.location_id === sideDoorId);

        if(sideDoorState) {

          updateDoorFromLocationState(hub, sideDoorState, true);
        }
      }
    }
  }
}

// Handle location update events (v2 API).
function handleLocationUpdate(hub: AccessHub, packet: AccessEventPacket): void {

  // Only process for UA Gate hubs.
  if(!hub.catalog.usesLocationApi) {

    return;
  }

  const locationData = packet.data as unknown as AccessEventLocationUpdate;

  if(!locationData.state) {

    return;
  }

  // Skip during gate transition since the controller sends noisy/unreliable state for all doors while the gate is moving.
  if((Date.now() < hub.gateTransitionUntil) || (Date.now() < hub.sideDoorGateTransitionUntil)) {

    return;
  }

  const locationId = locationData.id;
  const isMainDoor = locationId === hub.mainDoorLocationId;
  const isSideDoor = locationId === hub.sideDoorLocationId;

  if(isMainDoor) {

    updateDoorFromLocationState(hub, locationData.state, false);

    // Sync door name changes to HomeKit.
    if(locationData.name && (hub.mainDoorName !== locationData.name)) {

      hub.mainDoorName = locationData.name;
      hub.configureInfo();
    }
  } else if(isSideDoor && hub.hints.hasSideDoor) {

    updateDoorFromLocationState(hub, locationData.state, true);

    // Sync door name changes to HomeKit.
    if(locationData.name && (hub.sideDoorName !== locationData.name)) {

      hub.sideDoorName = locationData.name;
      updateSideDoorServiceNames(hub);
    }
  }
}

// Handle doorbell ring events.
function handleDoorbellRing(hub: AccessHub, packet: AccessEventPacket): void {

  if(((packet.data as AccessEventDoorbellRing).connected_uah_id !== hub.uda.unique_id) || !hasCapability(hub, 'door_bell')) {

    return;
  }

  hub.doorbellRingRequestId = (packet.data as AccessEventDoorbellRing).request_id;

  // Trigger the doorbell event in HomeKit.
  hub.accessory.getService(hub.hap.Service.Doorbell)?.getCharacteristic(hub.hap.Characteristic.ProgrammableSwitchEvent)
    ?.sendEventNotification(hub.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);

  // Emit on the hub event bus for trigger switch and MQTT.
  hub.hubEvents.emit('doorbell:ring', { requestId: hub.doorbellRingRequestId });

  if(hub.hints.logDoorbell) {

    hub.log.info('Doorbell ring detected.');
  }
}

// Handle doorbell cancel events.
function handleDoorbellCancel(hub: AccessHub, packet: AccessEventPacket): void {

  if(hub.doorbellRingRequestId !== (packet.data as AccessEventDoorbellCancel).remote_call_request_id) {

    return;
  }

  hub.doorbellRingRequestId = null;

  // Emit on the hub event bus for trigger switch and MQTT.
  hub.hubEvents.emit('doorbell:cancel', {} as Record<string, never>);

  if(hub.hints.logDoorbell) {

    hub.log.info('Doorbell ring cancelled.');
  }
}

// Update door state from location data (lock and DPS).
function updateDoorFromLocationState(
  hub: AccessHub,
  doorState: { lock: 'locked' | 'unlocked'; dps: 'open' | 'close' },
  isSideDoor: boolean,
): void {

  const newLockState = toLockState(hub, doorState.lock);
  const newDpsState = toDpsState(hub, doorState.dps);

  // Update lock state if changed. The hub event bus will handle MQTT publishing and logging.
  if(isSideDoor) {

    if(newLockState !== hub._hkSideDoorLockState) {

      hub.hkSideDoorLockState = newLockState;
    }
  } else if(newLockState !== hub._hkLockState) {

    hub.hkLockState = newLockState;
  }

  // Update DPS state if changed. The hub event bus will handle MQTT publishing and logging.
  if(isSideDoor) {

    if(newDpsState !== hub._hkSideDoorDpsState) {

      hub._hkSideDoorDpsState = newDpsState;
      hub.hubEvents.emit('dps:changed', { isSideDoor: true, value: newDpsState });
    }
  } else if(newDpsState !== hub._hkDpsState) {

    hub.hkDpsState = newDpsState;
  }
}
