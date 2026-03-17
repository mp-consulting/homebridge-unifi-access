/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-hub-services.ts: HomeKit service configuration and state-change reactions for the UniFi Access hub.
 */
import type { CharacteristicValue } from 'homebridge';
import type { SensorInput } from '../access-device-catalog.js';
import { AccessReservedNames } from '../access-types.js';
import { acquireService, sanitizeName, validService } from 'homebridge-plugin-utils';
import { GATE_TRANSITION_COOLDOWN_MS, accessMethods, getConfigValue, type HasWiringHintKey, type HubEventMap, terminalInputs } from './access-hub-types.js';
import { HK_CHARACTERISTIC_REVERT_DELAY_MS } from '../settings.js';
import type { AccessHub } from './access-hub.js';
import { hubDoorLockCommand } from './access-hub-api.js';
import { doorServiceType, hasCapability, hubInputState, hubLockState, isClosed, isLocked, isWired } from './access-hub-utils.js';

// Start a 3-phase gate cycle: Opening → Open → Closing. The full gateDirectionDuration is split into equal thirds. DPS "close" confirms the final Closed state.
function startGateCycle(hub: AccessHub): void {

  hub.clearGatePhaseTimers();

  const phaseDuration = hub.gateDirectionDuration / 3;

  hub.gateDirection = 'opening';
  hub.gateDirectionUntil = Date.now() + hub.gateDirectionDuration;

  hub.log.debug('Gate cycle started: Opening → Open (%.0fs) → Closing (%.0fs) → DPS confirms Closed (%.0fs total).',
    phaseDuration / 1000, (phaseDuration * 2) / 1000, hub.gateDirectionDuration / 1000);

  const gdoService = hub.accessory.getService(hub.hap.Service.GarageDoorOpener);

  // Push initial Opening state.
  if(gdoService) {

    gdoService.updateCharacteristic(hub.hap.Characteristic.TargetDoorState, hub.hap.Characteristic.TargetDoorState.OPEN);
    gdoService.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.OPENING);
  }

  // Phase 2: transition to Open after 1/3 of the duration.
  hub.gatePhaseTimers.push(setTimeout(() => {

    hub.gateDirection = 'open';
    hub.log.debug('Gate cycle phase: Open.');
    gdoService?.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.OPEN);
  }, phaseDuration));

  // Phase 3: transition to Closing after 2/3 of the duration.
  hub.gatePhaseTimers.push(setTimeout(() => {

    hub.gateDirection = 'closing';
    hub.log.debug('Gate cycle phase: Closing.');

    if(gdoService) {

      gdoService.updateCharacteristic(hub.hap.Characteristic.TargetDoorState, hub.hap.Characteristic.TargetDoorState.CLOSED);
      gdoService.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.CLOSING);
    }
  }, phaseDuration * 2));
}

// Start a DPS-driven gate cycle for external triggers (physical remote, manual override). Unlike startGateCycle which uses fixed timers for all
// three phases, this only animates Opening → Open and then waits for the DPS sensor to drive the Closing → Closed transition when the gate
// physically closes. This ensures HomeKit accurately reflects the real-world gate position rather than guessing closing timing with a timer.
function startExternalGateCycle(hub: AccessHub): void {

  hub.clearGatePhaseTimers();

  const phaseDuration = hub.gateDirectionDuration / 3;

  hub.gateDirection = 'opening';
  hub.gateDirectionUntil = Date.now() + hub.gateDirectionDuration;

  hub.log.debug('External gate cycle started: Opening → Open (%.0fs) → waiting for DPS close.', phaseDuration / 1000);

  const gdoService = hub.accessory.getService(hub.hap.Service.GarageDoorOpener);

  // Push initial Opening state.
  if(gdoService) {

    gdoService.updateCharacteristic(hub.hap.Characteristic.TargetDoorState, hub.hap.Characteristic.TargetDoorState.OPEN);
    gdoService.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.OPENING);
  }

  // Phase 2: transition to Open after a brief opening animation. No closing phase timer — the hkDpsState setter detects DPS close during the 'open' phase and
  // transitions to Closing automatically, then the dps:changed handler finalizes to Closed.
  hub.gatePhaseTimers.push(setTimeout(() => {

    hub.gateDirection = 'open';
    hub.log.debug('External gate cycle phase: Open — waiting for DPS close.');
    gdoService?.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.OPEN);
  }, phaseDuration));
}

// Configure all HomeKit services on the hub. Called once at device setup.
export function configureServices(hub: AccessHub): void {

  // Configure access method switches, if we're a reader device.
  configureAccessMethodSwitches(hub);

  // Configure the sensors connected to terminal inputs. This must be done before configuring the lock so that the DPS contact sensor exists when configuring a
  // GarageDoorOpener service, which derives its state from the DPS sensor.
  configureTerminalInputs(hub);
  configureSideDoorTerminalInputs(hub);

  // Configure the lock, if we're a hub device.
  configureLock(hub);
  configureLockTrigger(hub, false);

  // Configure the side door lock, if we're a UA Gate device.
  configureSideDoorLock(hub);
  configureLockTrigger(hub, true);

  // Configure the doorbell, if we have one.
  configureDoorbell(hub);
  configureDoorbellTrigger(hub);
}

// Register state-change reaction handlers on the hub event bus.
export function registerServiceReactions(hub: AccessHub): void {

  // React to lock state changes by updating the Lock or GarageDoorOpener service.
  hub.hubEvents.on('lock:changed', (data: HubEventMap['lock:changed']) => {

    const serviceType = data.isSideDoor ? 'Lock' : doorServiceType(hub);
    const triggerSubtype = data.isSideDoor ? AccessReservedNames.SWITCH_LOCK_DOOR_SIDE_TRIGGER : AccessReservedNames.SWITCH_LOCK_TRIGGER;

    if(serviceType === 'GarageDoorOpener') {

      // For UA Gate, lock trigger only (GarageDoorOpener state is driven by DPS events, not lock events).
      if(hub.catalog.usesLocationApi) {

        // Track gate direction for external triggers (NFC, remote, physical button). Start a 3-phase cycle for opening, or set closing direction directly.
        // Skip if a cycle is already active (e.g. from a HomeKit command).
        if(!data.isSideDoor && !isLocked(hub, data.value) && (Date.now() >= hub.gateDirectionUntil)) {

          if(isClosed(hub, hub._hkDpsState)) {

            // Gate is closed, starting to open → start 3-phase cycle (Opening → Open → Closing).
            startGateCycle(hub);
          } else {

            // Gate is open, starting to close.
            hub.clearGatePhaseTimers();
            hub.gateDirection = 'closing';
            hub.gateDirectionUntil = Date.now() + (hub.gateDirectionDuration / 3);

            const gdoService = hub.accessory.getService(hub.hap.Service.GarageDoorOpener);

            if(gdoService) {

              gdoService.updateCharacteristic(hub.hap.Characteristic.TargetDoorState, hub.hap.Characteristic.TargetDoorState.CLOSED);
              gdoService.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.CLOSING);
            }
          }
        }

        hub.accessory.getServiceById(hub.hap.Service.Switch, triggerSubtype)?.updateCharacteristic(hub.hap.Characteristic.On, !isLocked(hub, data.value));

        return;
      }

      // Non-UA Gate hubs: derive GarageDoorOpener state from lock relay.
      const service = hub.accessory.getService(hub.hap.Service.GarageDoorOpener);

      if(service) {

        const doorState = isLocked(hub, data.value) ? hub.hap.Characteristic.CurrentDoorState.CLOSED : hub.hap.Characteristic.CurrentDoorState.OPEN;
        const targetState = isLocked(hub, data.value) ? hub.hap.Characteristic.TargetDoorState.CLOSED : hub.hap.Characteristic.TargetDoorState.OPEN;

        service.updateCharacteristic(hub.hap.Characteristic.TargetDoorState, targetState);
        service.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, doorState);
      }
    } else {

      // Lock service update.
      const service = data.isSideDoor ? hub.accessory.getServiceById(hub.hap.Service.LockMechanism, AccessReservedNames.LOCK_DOOR_SIDE) :
        hub.accessory.getService(hub.hap.Service.LockMechanism);

      if(service) {

        service.updateCharacteristic(hub.hap.Characteristic.LockTargetState, isLocked(hub, data.value) ?
          hub.hap.Characteristic.LockTargetState.SECURED : hub.hap.Characteristic.LockTargetState.UNSECURED);
        service.updateCharacteristic(hub.hap.Characteristic.LockCurrentState, data.value);
      }
    }

    // Update the lock trigger switch if enabled.
    hub.accessory.getServiceById(hub.hap.Service.Switch, triggerSubtype)?.updateCharacteristic(hub.hap.Characteristic.On, !isLocked(hub, data.value));

    // Log lock state changes.
    if(hub.hints.logLock) {

      if(data.isSideDoor) {

        hub.log.info('%s %s.', hub.sideDoorName ?? 'Side door', isLocked(hub, data.value) ? 'locked' : 'unlocked');
      } else if(hub.catalog.usesLocationApi) {

        hub.log.info('%s %s.', hub.mainDoorName ?? 'Gate', isLocked(hub, data.value) ? 'locked' : 'unlocked');
      } else {

        hub.log.info(isLocked(hub, data.value) ? 'Locked.' : 'Unlocked.');
      }
    }
  });

  // React to DPS state changes by updating the GarageDoorOpener or side door contact sensor.
  hub.hubEvents.on('dps:changed', (data: HubEventMap['dps:changed']) => {

    // Log DPS state changes.
    if(hub.hints.logDps) {

      hub.log.info('%s position sensor %s.', data.isSideDoor ? (hub.sideDoorName ?? 'Side door') : (hub.mainDoorName ?? 'Door'),
        isClosed(hub, data.value) ? 'closed' : 'open');
    }

    // Side door DPS: update the side door contact sensor and return — the GarageDoorOpener only reflects main door state.
    if(data.isSideDoor) {

      hub.accessory.getServiceById(hub.hap.Service.ContactSensor, AccessReservedNames.CONTACT_DPS_SIDE)
        ?.updateCharacteristic(hub.hap.Characteristic.ContactSensorState, data.value);

      return;
    }

    if(doorServiceType(hub) !== 'GarageDoorOpener' || !hub.catalog.usesLocationApi) {

      return;
    }

    // During the opening and open phases, the timer drives GDO state — don't update from DPS events.
    if(hub.gateDirection === 'opening' || hub.gateDirection === 'open') {

      hub.log.debug('Gate DPS event ignored during %s phase.', hub.gateDirection);

      return;
    }

    const service = hub.accessory.getService(hub.hap.Service.GarageDoorOpener);

    if(!service) {

      return;
    }

    // During the closing phase, only DPS "close" finalizes to Closed.
    if(hub.gateDirection === 'closing') {

      if(data.value === hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED) {

        hub.log.debug('Gate DPS confirmed Closed — cycle complete, cooldown active.');
        hub.clearGatePhaseTimers();

        // Keep "closing" direction active as a cooldown to suppress DPS bounce after the gate settles. The bounce filter will suppress any
        // DPS "open" events until the cooldown expires. Use one phase duration (1/3 of the full cycle) to cover the settling period.
        hub.gateDirectionUntil = Date.now() + (hub.gateDirectionDuration / 3);

        service.updateCharacteristic(hub.hap.Characteristic.TargetDoorState, hub.hap.Characteristic.TargetDoorState.CLOSED);
        service.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.CLOSED);
      }

      return;
    }

    // No active gate cycle — if DPS reports open, an external trigger (physical remote, manual override) opened the gate. Start a DPS-driven gate cycle that
    // animates Opening → Open, then waits for the DPS sensor to report close for the Closing → Closed transition.
    if(!isClosed(hub, data.value)) {

      hub.log.debug('Gate DPS open detected (no active cycle) — starting external gate cycle.');
      startExternalGateCycle(hub);

      return;
    }

    // DPS reports closed with no active cycle — update GDO state directly.
    hub.log.debug('Gate DPS update (no active cycle): Closed.');
    service.updateCharacteristic(hub.hap.Characteristic.TargetDoorState, hub.hap.Characteristic.TargetDoorState.CLOSED);
    service.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.CLOSED);
  });

  // React to doorbell ring events by updating the doorbell trigger switch.
  hub.hubEvents.on('doorbell:ring', () => {

    hub.accessory.getServiceById(hub.hap.Service.Switch, AccessReservedNames.SWITCH_DOORBELL_TRIGGER)?.updateCharacteristic(hub.hap.Characteristic.On, true);
  });

  // React to doorbell cancel events by updating the doorbell trigger switch.
  hub.hubEvents.on('doorbell:cancel', () => {

    hub.accessory.getServiceById(hub.hap.Service.Switch, AccessReservedNames.SWITCH_DOORBELL_TRIGGER)?.updateCharacteristic(hub.hap.Characteristic.On, false);
  });

  // Log sensor state changes (REL, REN, REX - DPS is logged by dps:changed).
  hub.hubEvents.on('sensor:changed', (data: HubEventMap['sensor:changed']) => {

    // DPS logging is handled by the dps:changed handler.
    if(data.input === 'Dps') {

      return;
    }

    if(!isWired(hub, data.input)) {

      return;
    }

    const logKey = ('log' + data.input) as keyof typeof hub.hints;
    const label = terminalInputs.find(t => t.input === data.input)?.label;

    if(label && hub.hints[logKey]) {

      hub.log.info('%s %s.', label, isClosed(hub, data.value) ? 'closed' : 'open');
    }
  });

  // React to device online status changes by updating contact sensor StatusActive.
  hub.hubEvents.on('device:online', (data: HubEventMap['device:online']) => {

    for(const sensor of Object.keys(AccessReservedNames).filter(key => key.startsWith('CONTACT_'))) {

      hub.accessory.getServiceById(hub.hap.Service.ContactSensor, AccessReservedNames[sensor as keyof typeof AccessReservedNames])?.
        updateCharacteristic(hub.hap.Characteristic.StatusActive, data.isOnline);
    }
  });
}

// Configure the access method switches for HomeKit.
function configureAccessMethodSwitches(hub: AccessHub): boolean {

  for(const accessMethod of accessMethods) {

    // Validate whether we should have this service enabled.
    if(!validService(hub.accessory, hub.hap.Service.Switch,
      hasCapability(hub, 'is_reader') && hasCapability(hub, accessMethod.capability) && hub.hasFeature(accessMethod.option), accessMethod.subtype)) {

      continue;
    }

    // Acquire the service.
    const service = acquireService(hub.accessory, hub.hap.Service.Switch, hub.accessoryName + ' ' + accessMethod.name, accessMethod.subtype);

    if(!service) {

      hub.log.error('Unable to add the %s access method switch.', accessMethod.name);

      continue;
    }

    // Retrieve the state when requested.
    service.getCharacteristic(hub.hap.Characteristic.On).onGet(() => getConfigValue(hub.uda.configs, accessMethod.key) === 'yes');

    // Set the state when requested.
    service.getCharacteristic(hub.hap.Characteristic.On).onSet(async (value: CharacteristicValue) => {

      const entry = getConfigValue(hub.uda.configs, accessMethod.key);
      const isConfigsApi = hub.catalog.usesConfigsApi;
      let success;

      if(entry) {

        const endpoint = isConfigsApi ? '/configs?is_camera=true' : '/settings';
        const keys = (isConfigsApi && ('configsApiKeys' in accessMethod)) ? accessMethod.configsApiKeys : [accessMethod.key];
        const payload = keys.map(key => ({ key: key, tag: 'open_door_mode', value: value ? 'yes' : 'no' }));

        const response = await hub.controller.udaApi.retrieve(hub.controller.udaApi.getApiEndpoint('device') + '/' + hub.uda.unique_id + endpoint, {

          body: JSON.stringify(payload),
          method: 'PUT',
        });

        success = hub.controller.udaApi.responseOk(response?.statusCode);
      }

      // If we didn't find the configuration entry or we didn't succeed in setting the value, revert our switch state.
      if(!success) {

        hub.log.error('Unable to %s the %s access method.', value ? 'activate' : 'deactivate', accessMethod.name);
        setTimeout(() => service.updateCharacteristic(hub.hap.Characteristic.On, !value), HK_CHARACTERISTIC_REVERT_DELAY_MS);
      }
    });

    // Initialize the switch.
    service.updateCharacteristic(hub.hap.Characteristic.On, getConfigValue(hub.uda.configs, accessMethod.key) === 'yes');
  }

  return true;
}

// Configure the doorbell service for HomeKit.
function configureDoorbell(hub: AccessHub): boolean {

  // Validate whether we should have this service enabled.
  if(!validService(hub.accessory, hub.hap.Service.Doorbell, hasCapability(hub, 'door_bell') && hub.hasFeature('Hub.Doorbell'))) {

    return false;
  }

  // Acquire the service.
  const service = acquireService(hub.accessory, hub.hap.Service.Doorbell, hub.accessoryName, undefined, () => hub.log.info('Enabling the doorbell.'));

  if(!service) {

    hub.log.error('Unable to add the doorbell.');

    return false;
  }

  service.setPrimaryService(true);

  return true;
}

// Configure a switch to manually trigger a doorbell ring event for HomeKit.
function configureDoorbellTrigger(hub: AccessHub): boolean {

  // Validate whether we should have this service enabled.
  if(!validService(hub.accessory, hub.hap.Service.Switch, hasCapability(hub, 'door_bell') && hub.hasFeature('Hub.Doorbell.Trigger'),
    AccessReservedNames.SWITCH_DOORBELL_TRIGGER)) {

    return false;
  }

  // Acquire the service.
  const service = acquireService(hub.accessory, hub.hap.Service.Switch, hub.accessoryName + ' Doorbell Trigger',
    AccessReservedNames.SWITCH_DOORBELL_TRIGGER, () => hub.log.info('Enabling the doorbell automation trigger.'));

  if(!service) {

    hub.log.error('Unable to add the doorbell automation trigger.');

    return false;
  }

  // Trigger the doorbell.
  service.getCharacteristic(hub.hap.Characteristic.On).onGet(() => hub.doorbellRingRequestId !== null);

  // The state isn't really user-triggerable. We have no way, currently, to trigger a ring event on the hub.
  service.getCharacteristic(hub.hap.Characteristic.On).onSet(() => {

    setTimeout(() => service.updateCharacteristic(hub.hap.Characteristic.On, hub.doorbellRingRequestId !== null), HK_CHARACTERISTIC_REVERT_DELAY_MS);
  });

  // Initialize the switch.
  service.updateCharacteristic(hub.hap.Characteristic.ConfiguredName, hub.accessoryName + ' Doorbell Trigger');
  service.updateCharacteristic(hub.hap.Characteristic.On, false);

  return true;
}

// Configure contact sensors for HomeKit. Availability is determined by a combination of hub model, what's been configured on the hub, and feature options.
export function configureTerminalInputs(hub: AccessHub): boolean {

  for(const { input, label } of terminalInputs) {

    const hint = ('hasWiring' + input) as HasWiringHintKey;
    const reservedId = AccessReservedNames[('CONTACT_' + input.toUpperCase()) as keyof typeof AccessReservedNames];

    // Validate whether we should have this service enabled.
    if(!validService(hub.accessory, hub.hap.Service.ContactSensor, (hasService: boolean) => {

      if(!hub.hints[hint] && hasService) {

        hub.log.info('Disabling the ' + label.toLowerCase() + '.');
      }

      return hub.hints[hint];
    }, reservedId)) {

      continue;
    }

    // Acquire the service.
    const service = acquireService(hub.accessory, hub.hap.Service.ContactSensor, hub.accessoryName + ' ' + label, reservedId,
      () => hub.log.info('Enabling the ' + label.toLowerCase() + '.'));

    if(!service) {

      hub.log.error('Unable to add the ' + label.toLowerCase() + '.');

      continue;
    }

    // Initialize the sensor state.
    service.updateCharacteristic(hub.hap.Characteristic.ContactSensorState, hubInputState(hub, input as SensorInput));
    service.updateCharacteristic(hub.hap.Characteristic.StatusActive, !!hub.uda.is_online);
    configureTamperDetection(hub, service);
  }

  return true;
}

// Configure contact sensors for the side door terminal inputs on UA Gate hubs.
function configureSideDoorTerminalInputs(hub: AccessHub): boolean {

  // We only configure side door terminal inputs for UA Gate hubs that have the side door enabled.
  if(!hub.hints.hasSideDoor) {

    return false;
  }

  // Validate whether we should have this service enabled. We check the hasWiringSideDoorDps hint which already incorporates the feature option check.
  if(!validService(hub.accessory, hub.hap.Service.ContactSensor, (hasService: boolean) => {

    if(!hub.hints.hasWiringSideDoorDps && hasService) {

      hub.log.info('Disabling the side door position sensor.');
    }

    return hub.hints.hasWiringSideDoorDps;
  }, AccessReservedNames.CONTACT_DPS_SIDE)) {

    return false;
  }

  // Acquire the service.
  const service = acquireService(hub.accessory, hub.hap.Service.ContactSensor, hub.accessoryName + ' Side Door Position Sensor',
    AccessReservedNames.CONTACT_DPS_SIDE, () => hub.log.info('Enabling the side door position sensor.'));

  if(!service) {

    hub.log.error('Unable to add the side door position sensor.');

    return false;
  }

  // Initialize the sensor state from the current side door DPS state.
  service.updateCharacteristic(hub.hap.Characteristic.ContactSensorState, hub._hkSideDoorDpsState);
  service.updateCharacteristic(hub.hap.Characteristic.StatusActive, !!hub.uda.is_online);
  configureTamperDetection(hub, service);

  return true;
}

// Configure the door for HomeKit. Supports Lock and GarageDoorOpener service types.
function configureLock(hub: AccessHub): boolean {

  const currentServiceType = doorServiceType(hub);

  // First, remove any previous service types that are no longer selected.
  const serviceTypes = [ hub.hap.Service.LockMechanism, hub.hap.Service.GarageDoorOpener ];
  const selectedService = currentServiceType === 'GarageDoorOpener' ? hub.hap.Service.GarageDoorOpener : hub.hap.Service.LockMechanism;

  for(const serviceType of serviceTypes) {

    if(serviceType !== selectedService) {

      const oldService = hub.accessory.getService(serviceType);

      if(oldService) {

        hub.accessory.removeService(oldService);
      }
    }
  }

  // Validate whether we should have this service enabled.
  if(!validService(hub.accessory, selectedService, hasCapability(hub, 'is_hub'))) {

    return false;
  }

  // Acquire the service.
  const service = acquireService(hub.accessory, selectedService, hub.accessoryName, undefined,
    () => hub.log.info('Configuring door as %s service.', currentServiceType));

  if(!service) {

    hub.log.error('Unable to add the door.');

    return false;
  }

  // Configure based on service type.
  if(currentServiceType === 'GarageDoorOpener') {

    configureGarageDoorService(hub, service, false);
  } else {

    configureLockService(hub, service, false);
  }

  // Initialize the state.
  hub._hkLockState = -1;
  service.displayName = hub.accessoryName;
  service.updateCharacteristic(hub.hap.Characteristic.Name, hub.accessoryName);

  // Ensure ConfiguredName is available and set — HomeKit uses this over Name for display.
  if(!service.testCharacteristic(hub.hap.Characteristic.ConfiguredName)) {

    service.addOptionalCharacteristic(hub.hap.Characteristic.ConfiguredName);
  }

  service.updateCharacteristic(hub.hap.Characteristic.ConfiguredName, hub.accessoryName);
  hub.hkLockState = hubLockState(hub);

  service.setPrimaryService(true);

  return true;
}

// Configure a LockMechanism service.
function configureLockService(hub: AccessHub, service: ReturnType<typeof acquireService>, isSideDoor: boolean): void {

  if(!service) {

    return;
  }

  const lockStateGetter = isSideDoor ? (): CharacteristicValue => hub.hkSideDoorLockState : (): CharacteristicValue => hub.hkLockState;
  const lockCommand = async (lock: boolean): Promise<boolean> => hubDoorLockCommand(hub, lock, isSideDoor);

  service.getCharacteristic(hub.hap.Characteristic.LockCurrentState).onGet(lockStateGetter);
  service.getCharacteristic(hub.hap.Characteristic.LockTargetState).onGet(lockStateGetter);

  service.getCharacteristic(hub.hap.Characteristic.LockTargetState).onSet(async (value: CharacteristicValue) => {

    // Check if this is just syncing state from an event (current state already matches target).
    const currentState = lockStateGetter();
    const targetLocked = value === hub.hap.Characteristic.LockTargetState.SECURED;
    const currentlyLocked = isLocked(hub, currentState);

    // If state already matches, this is just a sync from an event - don't send command.
    if(targetLocked === currentlyLocked) {

      return;
    }

    if(!(await lockCommand(targetLocked))) {

      const revertState = currentlyLocked
        ? hub.hap.Characteristic.LockTargetState.SECURED : hub.hap.Characteristic.LockTargetState.UNSECURED;

      setTimeout(() => service.updateCharacteristic(hub.hap.Characteristic.LockTargetState, revertState), HK_CHARACTERISTIC_REVERT_DELAY_MS);
    }

    service.updateCharacteristic(hub.hap.Characteristic.LockCurrentState, lockStateGetter());
  });
}

// Configure a GarageDoorOpener service.
function configureGarageDoorService(hub: AccessHub, service: ReturnType<typeof acquireService>, isSideDoor: boolean): void {

  if(!service) {

    return;
  }

  // For devices using the location API, we use unlock/trigger command for both open and close operations.
  const isUaGate = hub.catalog.usesLocationApi;

  // Determine the current door state.
  const getDoorState = (): CharacteristicValue => {

    if(isUaGate) {

      // Return the current gate cycle phase state.
      if(!isSideDoor && hub.gateDirection && (Date.now() < hub.gateDirectionUntil)) {

        if(hub.gateDirection === 'opening') {

          return hub.hap.Characteristic.CurrentDoorState.OPENING;
        }

        if(hub.gateDirection === 'open') {

          return hub.hap.Characteristic.CurrentDoorState.OPEN;
        }

        return hub.hap.Characteristic.CurrentDoorState.CLOSING;
      }

      const dpsState = isSideDoor ? hub._hkSideDoorDpsState : hub.hkDpsState;

      return dpsState === hub.hap.Characteristic.ContactSensorState.CONTACT_DETECTED ? hub.hap.Characteristic.CurrentDoorState.CLOSED :
        hub.hap.Characteristic.CurrentDoorState.OPEN;
    }

    // Non-UA Gate hubs: derive from lock relay state.
    const lockState = isSideDoor ? hub.hkSideDoorLockState : hub.hkLockState;

    return isLocked(hub, lockState) ? hub.hap.Characteristic.CurrentDoorState.CLOSED : hub.hap.Characteristic.CurrentDoorState.OPEN;
  };

  service.getCharacteristic(hub.hap.Characteristic.CurrentDoorState).onGet(getDoorState);

  service.getCharacteristic(hub.hap.Characteristic.TargetDoorState).onSet(async (value: CharacteristicValue) => {

    const shouldClose = value === hub.hap.Characteristic.TargetDoorState.CLOSED;

    // UA Gate uses a single trigger command that toggles the motorized gate.
    if(isUaGate) {

      // Set a transition cooldown to prevent WebSocket events from immediately reverting the door state.
      if(isSideDoor) {

        hub.sideDoorGateTransitionUntil = Date.now() + GATE_TRANSITION_COOLDOWN_MS;

        // Immediately show transitional state for side door.
        service.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, shouldClose ? hub.hap.Characteristic.CurrentDoorState.CLOSING :
          hub.hap.Characteristic.CurrentDoorState.OPENING);
      } else {

        hub.gateTransitionUntil = Date.now() + GATE_TRANSITION_COOLDOWN_MS;

        // Start the 3-phase gate cycle (Opening → Open → Closing) for opening, or set closing direction directly.
        if(shouldClose) {

          hub.clearGatePhaseTimers();
          hub.gateDirection = 'closing';
          hub.gateDirectionUntil = Date.now() + (hub.gateDirectionDuration / 3);
          service.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, hub.hap.Characteristic.CurrentDoorState.CLOSING);
        } else {

          startGateCycle(hub);
        }
      }

      // Trigger the gate.
      if(!(await hubDoorLockCommand(hub, false, isSideDoor))) {

        // Clear the transition cooldown and direction on failure.
        if(isSideDoor) {

          hub.sideDoorGateTransitionUntil = 0;
        } else {

          hub.gateTransitionUntil = 0;
          hub.clearGatePhaseTimers();
          hub.gateDirection = null;
          hub.gateDirectionUntil = 0;
        }

        // Revert target state on failure.
        setTimeout(() => {

          service.updateCharacteristic(hub.hap.Characteristic.TargetDoorState,
            shouldClose ? hub.hap.Characteristic.TargetDoorState.OPEN : hub.hap.Characteristic.TargetDoorState.CLOSED);
          service.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, getDoorState());
        }, HK_CHARACTERISTIC_REVERT_DELAY_MS);
      }

      // The DPS sensor event will update the CurrentDoorState when the gate finishes moving.
      return;
    }

    // Non-UA Gate hubs: use lock/unlock commands directly.
    if(!(await hubDoorLockCommand(hub, shouldClose, isSideDoor))) {

      // Revert target state on failure.
      setTimeout(() => {

        service.updateCharacteristic(hub.hap.Characteristic.TargetDoorState,
          shouldClose ? hub.hap.Characteristic.TargetDoorState.OPEN : hub.hap.Characteristic.TargetDoorState.CLOSED);
        service.updateCharacteristic(hub.hap.Characteristic.CurrentDoorState, getDoorState());
      }, HK_CHARACTERISTIC_REVERT_DELAY_MS);
    }
  });

  // ObstructionDetected is required - we always report no obstruction.
  service.getCharacteristic(hub.hap.Characteristic.ObstructionDetected).onGet(() => false);
}

// Configure a switch to automate lock and unlock events in HomeKit.
function configureLockTrigger(hub: AccessHub, isSideDoor: boolean): boolean {

  const condition = isSideDoor
    ? hub.hints.hasSideDoor && hub.hasFeature('Hub.SideDoor.Lock.Trigger')
    : hasCapability(hub, 'is_hub') && hub.hasFeature('Hub.Lock.Trigger');
  const subtype = isSideDoor ? AccessReservedNames.SWITCH_LOCK_DOOR_SIDE_TRIGGER : AccessReservedNames.SWITCH_LOCK_TRIGGER;
  const label = isSideDoor ? 'Side Door Lock Trigger' : 'Lock Trigger';
  const logLabel = isSideDoor ? 'side door lock automation trigger' : 'lock automation trigger';

  // Validate whether we should have this service enabled.
  if(!validService(hub.accessory, hub.hap.Service.Switch, condition, subtype)) {

    return false;
  }

  // Acquire the service.
  const service = acquireService(hub.accessory, hub.hap.Service.Switch, hub.accessoryName + ' ' + label, subtype,
    () => hub.log.info('Enabling the %s.', logLabel));

  if(!service) {

    hub.log.error('Unable to add the %s.', logLabel);

    return false;
  }

  // Return the lock state.
  service.getCharacteristic(hub.hap.Characteristic.On)
    .onGet(() => !isLocked(hub, isSideDoor ? hub.hkSideDoorLockState : hub.hkLockState));

  // The state isn't really user-triggerable.
  service.getCharacteristic(hub.hap.Characteristic.On).onSet(async (value: CharacteristicValue) => {

    // If we are on, we are in an unlocked state. If we are off, we are in a locked state.
    if(!(await hubDoorLockCommand(hub, !value, isSideDoor))) {

      // Revert our state.
      setTimeout(() => service.updateCharacteristic(hub.hap.Characteristic.On, !value), HK_CHARACTERISTIC_REVERT_DELAY_MS);
    }
  });

  // Initialize the switch.
  service.updateCharacteristic(hub.hap.Characteristic.ConfiguredName, hub.accessoryName + ' ' + label);
  service.updateCharacteristic(hub.hap.Characteristic.On, false);

  return true;
}

// Configure the side door for HomeKit (UA Gate only) - always uses Lock service.
function configureSideDoorLock(hub: AccessHub): boolean {

  // Validate whether we should have this service enabled.
  if(!validService(hub.accessory, hub.hap.Service.LockMechanism, hub.hints.hasSideDoor, AccessReservedNames.LOCK_DOOR_SIDE)) {

    return false;
  }

  // Acquire the service.
  const service = acquireService(hub.accessory, hub.hap.Service.LockMechanism, hub.accessoryName + ' Side Door', AccessReservedNames.LOCK_DOOR_SIDE,
    () => hub.log.info('Configuring %s lock.', hub.sideDoorName ?? 'side door'));

  if(!service) {

    hub.log.error('Unable to add the side door.');

    return false;
  }

  // Configure the lock service.
  configureLockService(hub, service, true);

  // Initialize the lock.
  hub._hkSideDoorLockState = -1;
  service.displayName = hub.accessoryName + ' Side Door';
  service.updateCharacteristic(hub.hap.Characteristic.Name, hub.accessoryName + ' Side Door');

  // Ensure ConfiguredName is available and set — HomeKit uses this over Name for display.
  if(!service.testCharacteristic(hub.hap.Characteristic.ConfiguredName)) {

    service.addOptionalCharacteristic(hub.hap.Characteristic.ConfiguredName);
  }

  service.updateCharacteristic(hub.hap.Characteristic.ConfiguredName, hub.accessoryName + ' Side Door');
  hub.hkSideDoorLockState = hubLockState(hub, true);

  return true;
}

// Configure tamper detection on a contact sensor service if the hub supports it.
function configureTamperDetection(hub: AccessHub, service: ReturnType<typeof acquireService>): void {

  if(!service || !hasCapability(hub, 'tamper_proofing')) {

    return;
  }

  const tamperedEntry = getConfigValue(hub.uda.configs, 'tamper_event');

  if(tamperedEntry) {

    service.updateCharacteristic(hub.hap.Characteristic.StatusTampered, (tamperedEntry === 'true') ? hub.hap.Characteristic.StatusTampered.TAMPERED :
      hub.hap.Characteristic.StatusTampered.NOT_TAMPERED);
  }
}

// Update side door service names to use the discovered side door name instead of the generic "Side Door" suffix.
export function updateSideDoorServiceNames(hub: AccessHub): void {

  if(!hub.hints.syncName || !hub.sideDoorName) {

    return;
  }

  const name = sanitizeName(hub.sideDoorName);

  const sideDoorServices: { subtype: AccessReservedNames; suffix: string }[] = [
    { subtype: AccessReservedNames.LOCK_DOOR_SIDE, suffix: '' },
    { subtype: AccessReservedNames.CONTACT_DPS_SIDE, suffix: ' Door Position Sensor' },
    { subtype: AccessReservedNames.SWITCH_LOCK_DOOR_SIDE_TRIGGER, suffix: ' Lock Trigger' },
  ];

  for(const { subtype, suffix } of sideDoorServices) {

    const serviceType = subtype === AccessReservedNames.LOCK_DOOR_SIDE ? hub.hap.Service.LockMechanism :
      subtype === AccessReservedNames.CONTACT_DPS_SIDE ? hub.hap.Service.ContactSensor : hub.hap.Service.Switch;
    const service = hub.accessory.getServiceById(serviceType, subtype);

    if(!service) {

      continue;
    }

    const serviceName = name + suffix;

    service.displayName = serviceName;
    service.updateCharacteristic(hub.hap.Characteristic.Name, serviceName);

    if(service.testCharacteristic(hub.hap.Characteristic.ConfiguredName)) {

      service.updateCharacteristic(hub.hap.Characteristic.ConfiguredName, serviceName);
    }
  }
}

