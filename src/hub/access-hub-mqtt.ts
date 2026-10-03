/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-hub-mqtt.ts: MQTT configuration and state-change publishing for the UniFi Access hub.
 */
import type { CharacteristicValue } from 'homebridge';
import { type HubEventMap, terminalInputs } from './access-hub-types.js';
import type { AccessHub } from './access-hub.js';
import { hubDoorLockCommand } from './access-hub-api.js';
import { hasCapability, isClosed, isLocked, isSideDoorDpsWired, isWired } from './access-hub-utils.js';

// Translate a HomeKit lock state into its MQTT representation.
function lockStateToMqtt(hub: AccessHub, state: CharacteristicValue): string {

  switch(state) {

    case hub.hap.Characteristic.LockCurrentState.SECURED:

      return 'true';

    case hub.hap.Characteristic.LockCurrentState.UNSECURED:

      return 'false';

    default:

      return 'unknown';
  }
}

// Translate a HomeKit contact sensor state into its MQTT representation. We report whether the door is open.
function dpsStateToMqtt(hub: AccessHub, state: CharacteristicValue): string {

  switch(state) {

    case hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED:

      return 'false';

    case hub.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:

      return 'true';

    default:

      return 'unknown';
  }
}

// Subscribe to a lock set topic: "true" locks and "false" unlocks.
function subscribeLockSet(hub: AccessHub, topic: string, type: string, isSideDoor: boolean): void {

  hub.controller.mqtt?.subscribeSet(hub.id, topic, type, (value: string) => {

    if((value !== 'true') && (value !== 'false')) {

      hub.log.error('MQTT: Unknown %s set message received: %s.', type.toLowerCase(), value);

      return;
    }

    void hubDoorLockCommand(hub, value === 'true', isSideDoor);
  });
}

// Configure MQTT capabilities of this hub and subscribe to hub events for automatic state publishing.
export function configureMqtt(hub: AccessHub): boolean {

  // Always register event bus reactions for MQTT publishing, even for devices without a door (e.g. reader-only devices).
  registerMqttReactions(hub);

  // MQTT doorbell status.
  if(hasCapability(hub, 'door_bell')) {

    hub.controller.mqtt?.subscribeGet(hub.id, 'doorbell', 'Doorbell ring', () => (hub.doorbellRingRequestId !== null) ? 'true' : 'false');
  }

  // Door control is only available on hubs. We key off the device capability rather than a particular HomeKit service, since a hub's door may be exposed as
  // either a lock or a garage door opener.
  if(!hasCapability(hub, 'is_hub')) {

    return false;
  }

  // MQTT DPS status.
  hub.controller.mqtt?.subscribeGet(hub.id, 'dps', 'Door position sensor', () => isWired(hub, 'Dps') ? dpsStateToMqtt(hub, hub.hkDpsState) : 'unknown');

  // MQTT lock status and control.
  hub.controller.mqtt?.subscribeGet(hub.id, 'lock', 'Lock', () => lockStateToMqtt(hub, hub.hkLockState));
  subscribeLockSet(hub, 'lock', 'Lock', false);

  // MQTT side door subscriptions (UA Gate only).
  if(hub.hints.hasSideDoor) {

    hub.controller.mqtt?.subscribeGet(hub.id, 'sidedoor/lock', 'Side Door Lock', () => lockStateToMqtt(hub, hub.hkSideDoorLockState));
    subscribeLockSet(hub, 'sidedoor/lock', 'Side Door Lock', true);

    hub.controller.mqtt?.subscribeGet(hub.id, 'sidedoor/dps', 'Side door position sensor',
      () => isSideDoorDpsWired(hub) ? dpsStateToMqtt(hub, hub._hkSideDoorDpsState) : 'unknown');
  }

  return true;
}

// Remove the MQTT subscriptions for this hub, e.g. when it's removed from HomeKit.
export function removeMqtt(hub: AccessHub): void {

  for(const topic of [ 'doorbell/get', 'dps/get', 'lock/get', 'lock/set', 'sidedoor/lock/get', 'sidedoor/lock/set', 'sidedoor/dps/get' ]) {

    hub.controller.mqtt?.unsubscribe(hub.id, topic);
  }
}

// Register hub event bus handlers for MQTT publishing.
function registerMqttReactions(hub: AccessHub): void {

  // Publish lock state changes.
  hub.hubEvents.on('lock:changed', (data: HubEventMap['lock:changed']) => {

    const topic = data.isSideDoor ? 'sidedoor/lock' : 'lock';

    hub.controller.mqtt?.publish(hub.id, topic, isLocked(hub, data.value) ? 'true' : 'false');
  });

  // Publish DPS state changes.
  hub.hubEvents.on('dps:changed', (data: HubEventMap['dps:changed']) => {

    const topic = data.isSideDoor ? 'sidedoor/dps' : 'dps';
    const contactDetected = isClosed(hub, data.value);

    hub.controller.mqtt?.publish(hub.id, topic, contactDetected ? 'false' : 'true');
  });

  // Publish sensor state changes (REL, REN, REX - DPS is handled above).
  hub.hubEvents.on('sensor:changed', (data: HubEventMap['sensor:changed']) => {

    // DPS is handled by the dps:changed event.
    if(data.input === 'Dps') {

      return;
    }

    if(!isWired(hub, data.input)) {

      return;
    }

    const contactDetected = isClosed(hub, data.value);
    const topic = terminalInputs.find(t => t.input === data.input)?.topic;

    if(topic) {

      hub.controller.mqtt?.publish(hub.id, topic, contactDetected ? 'false' : 'true');
    }
  });

  // Publish doorbell state changes.
  hub.hubEvents.on('doorbell:ring', () => {

    hub.controller.mqtt?.publish(hub.id, 'doorbell', 'true');
  });

  hub.hubEvents.on('doorbell:cancel', () => {

    hub.controller.mqtt?.publish(hub.id, 'doorbell', 'false');
  });
}
