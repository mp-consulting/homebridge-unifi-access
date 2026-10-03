/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-hub-events.ts: External event parsing for the UniFi Access hub. Parses UniFi Access API events and updates hub state.
 * MQTT publishing and logging are handled automatically by the hub event bus subscribers.
 */
import type { AccessDeviceConfig, AccessEventDoorbellCancel, AccessEventDoorbellRing, AccessEventPacket } from '../unifi/index.js';
import { AccessEventType } from '../access-types.js';
import {
  ACCESSORY_GROUP_ACCESS_METHODS, ACCESSORY_GROUP_DOORBELL, type AccessEventDeviceUpdateV2, type AccessEventLocationUpdate,
  type AccessMethodKey, type HasWiringHintKey, accessMethods, terminalInputs,
} from './access-hub-types.js';
import { UGT_MAIN_PORT_SOURCE_ID, UGT_SIDE_PORT_SOURCE_ID } from '../access-device-catalog.js';
import type { AccessHub, HkStateKey } from './access-hub.js';
import { configureTerminalInputs, updateSideDoorServiceNames } from './access-hub-services.js';
import {
  checkUltraInputs, hasCapability, hubInputState, hubLockState, serviceHost, toDpsState, toLockState,
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

    // Set unlocked state and schedule the auto-lock. The hub event bus will handle MQTT publishing and logging.
    hub.scheduleAutoRelock(!!isSideDoor);
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

  // Side door state on UA Gate hubs arrives through v2 location updates rather than v1 device updates, since UA Gate skips v1 lock events.

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

  // Process any changes to terminal input configuration. Nearly every update carries the terminal input configuration, so we only reconfigure our services when
  // the selected input mode has actually changed.
  if((packet.data as AccessDeviceConfig).extensions?.[0]?.target_config && hub.catalog.usesProxyMode) {

    const wasWired = [ hub.hints.hasWiringDps, hub.hints.hasWiringRex ];

    checkUltraInputs(hub);

    if((wasWired[0] !== hub.hints.hasWiringDps) || (wasWired[1] !== hub.hints.hasWiringRex)) {

      configureTerminalInputs(hub);
    }
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

        serviceHost(hub, ACCESSORY_GROUP_ACCESS_METHODS).getServiceById(hub.hap.Service.Switch, accessMethod.subtype)
          ?.updateCharacteristic(hub.hap.Characteristic.On, value === 'yes');
      }
    }
  }

  // Process location_states for UA Gate hubs - this contains lock state per door. Skip during gate transition since the controller sends
  // noisy/unreliable state for both doors in the same event while the gate is moving.
  if(data.location_states && hub.catalog.usesLocationApi && (Date.now() >= hub.gateTransitionUntil)) {

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
  if(Date.now() < hub.gateTransitionUntil) {

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

  // If the user has configured a ring delay, suppress any rings that arrive within that window of the last one we delivered.
  const ringDelay = (hub.platform.config.ringDelay ?? 0) * 1000;
  const now = Date.now();

  if(ringDelay && ((now - hub.lastDoorbellRing) < ringDelay)) {

    hub.log.debug('Doorbell ring suppressed: within the configured ring delay of the previous ring.');

    return;
  }

  hub.lastDoorbellRing = now;

  // Trigger the doorbell event in HomeKit.
  serviceHost(hub, ACCESSORY_GROUP_DOORBELL).getService(hub.hap.Service.Doorbell)?.getCharacteristic(hub.hap.Characteristic.ProgrammableSwitchEvent)
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
