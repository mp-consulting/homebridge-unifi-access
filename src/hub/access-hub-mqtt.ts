/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-hub-mqtt.ts: MQTT configuration and state-change publishing for the UniFi Access hub.
 */
import { type HubEventMap, terminalInputs } from './access-hub-types.js';
import type { AccessHub } from './access-hub.js';
import { hubDoorLockCommand } from './access-hub-api.js';
import { isClosed, isLocked, isSideDoorDpsWired, isWired } from './access-hub-utils.js';

// Configure MQTT capabilities of this hub and subscribe to hub events for automatic state publishing.
export function configureMqtt(hub: AccessHub): boolean {

  // Always register event bus reactions for MQTT publishing, even if no lock service (e.g. reader-only devices).
  registerMqttReactions(hub);

  const lockService = hub.accessory.getService(hub.hap.Service.LockMechanism);

  if(!lockService) {

    return false;
  }

  // MQTT doorbell status.
  hub.controller.mqtt?.subscribeGet(hub.id, 'doorbell', 'Doorbell ring', () => {

    return hub.doorbellRingRequestId !== null ? 'true' : 'false';
  });

  // MQTT DPS status.
  hub.controller.mqtt?.subscribeGet(hub.id, 'dps', 'Door position sensor', () => {

    if(!isWired(hub, 'Dps')) {

      return 'unknown';
    }

    switch(hub.hkDpsState) {

      case hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED:

        return 'false';


      case hub.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:

        return 'true';

      default:

        return 'unknown';
    }
  });

  // MQTT lock status.
  hub.controller.mqtt?.subscribeGet(hub.id, 'lock', 'Lock', () => {

    switch(hub.hkLockState) {

      case hub.hap.Characteristic.LockCurrentState.SECURED:

        return 'true';

      case hub.hap.Characteristic.LockCurrentState.UNSECURED:

        return 'false';

      default:

        return 'unknown';
    }
  });

  // MQTT lock set command.
  hub.controller.mqtt?.subscribeSet(hub.id, 'lock', 'Lock', (value: string) => {

    switch(value) {

      case 'true':

        void hubDoorLockCommand(hub, true);

        break;

      case 'false':

        void hubDoorLockCommand(hub, false);

        break;

      default:

        hub.log.error('MQTT: Unknown lock set message received: %s.', value);

        break;
    }
  });

  // MQTT side door subscriptions (UA Gate only).
  if(hub.hints.hasSideDoor) {

    hub.controller.mqtt?.subscribeGet(hub.id, 'sidedoor/lock', 'Side Door Lock', () => {

      switch(hub.hkSideDoorLockState) {

        case hub.hap.Characteristic.LockCurrentState.SECURED:

          return 'true';

        case hub.hap.Characteristic.LockCurrentState.UNSECURED:

          return 'false';

        default:

          return 'unknown';
      }
    });

    hub.controller.mqtt?.subscribeSet(hub.id, 'sidedoor/lock', 'Side Door Lock', (value: string) => {

      switch(value) {

        case 'true':

          void hubDoorLockCommand(hub, true, true);

          break;

        case 'false':

          void hubDoorLockCommand(hub, false, true);

          break;

        default:

          hub.log.error('MQTT: Unknown side door lock set message received: %s.', value);

          break;
      }
    });

    // MQTT side door DPS status.
    hub.controller.mqtt?.subscribeGet(hub.id, 'sidedoor/dps', 'Side door position sensor', () => {

      if(!isSideDoorDpsWired(hub)) {

        return 'unknown';
      }

      switch(hub._hkSideDoorDpsState) {

        case hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED:

          return 'false';

        case hub.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED:

          return 'true';

        default:

          return 'unknown';
      }
    });
  }

  return true;
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
