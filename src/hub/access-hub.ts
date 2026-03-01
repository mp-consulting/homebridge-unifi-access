/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * access-hub.ts: Core hub class for UniFi Access. State management, construction, orchestration, and static property definitions.
 */
import { EventEmitter } from 'events';
import type { AccessDeviceConfig } from 'unifi-access';
import type { CharacteristicValue, PlatformAccessory } from 'homebridge';
import { type DeviceCatalogEntry, type SensorInput, getDeviceCatalog } from '../access-device-catalog.js';
import type { AccessController } from '../access-controller.js';
import { AccessDevice } from '../access-device.js';
import { AccessReservedNames } from '../access-types.js';
import { ACCESS_GATE_DIRECTION_DURATION } from '../settings.js';
import { type AccessHubHKProps, type AccessHubWiredProps, type HubEventKey, type HubEventMap, type KeyOf, sensorInputs } from './access-hub-types.js';
import { discoverDoorNames, initializeDoorsFromApi } from './access-hub-api.js';
import { registerEventHandlers } from './access-hub-events.js';
import { configureMqtt } from './access-hub-mqtt.js';
import { configureServices, registerServiceReactions, updateSideDoorServiceNames } from './access-hub-services.js';
import {
  checkUltraInputs, getContactSensorState, hubDpsState, hubLockState, isWired, logLockDelayInterval, setContactSensorState,
} from './access-hub-utils.js';

// Merge the declarations into the definition of the class, so TypeScript knows that these properties will exist.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface AccessHub extends AccessHubHKProps, AccessHubWiredProps { }

// Key-union types that reference AccessHub must stay here due to the circular dependency with the class definition.
export type HkStateKey = KeyOf<AccessHub, 'hk', 'State'>;

// Typed event emitter wrapper for the hub event bus.
class HubEventBus {

  private readonly emitter = new EventEmitter();
  private logger?: (message: string, ...params: unknown[]) => void;

  emit<K extends HubEventKey>(event: K, data: HubEventMap[K]): void {

    this.logger?.('Event bus: %s %s.', event, JSON.stringify(data));
    this.emitter.emit(event, data);
  }

  on<K extends HubEventKey>(event: K, handler: (data: HubEventMap[K]) => void): void {

    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  setLogger(logger: (message: string, ...params: unknown[]) => void): void {

    this.logger = logger;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class AccessHub extends AccessDevice {

  // State backing fields - public for module access.
  public _hkDpsState: CharacteristicValue;
  public _hkLockState: CharacteristicValue;
  public _hkSideDoorDpsState: CharacteristicValue;
  public _hkSideDoorLockState: CharacteristicValue;

  // Device configuration - public for module access.
  public readonly catalog: DeviceCatalogEntry;
  public doorbellRingRequestId: string | null;
  public gateDirection: 'opening' | 'open' | 'closing' | null;
  public gateDirectionDuration: number;
  public gateDirectionUntil: number;
  public gatePhaseTimers: ReturnType<typeof setTimeout>[];
  public gateTransitionUntil: number;
  public lockDelayInterval: number | undefined;
  public mainDoorLocationId: string | undefined;
  public mainDoorName: string | undefined;
  public sideDoorLocationId: string | undefined;
  public sideDoorName: string | undefined;
  public sideDoorGateTransitionUntil: number;
  public uda: AccessDeviceConfig;

  // Internal event bus for state-change reactions.
  public readonly hubEvents = new HubEventBus();

  // Create an instance.
  constructor(controller: AccessController, device: AccessDeviceConfig, accessory: PlatformAccessory) {

    super(controller, accessory);

    this.hubEvents.setLogger(this.log.debug.bind(this.log));

     
    this.catalog = getDeviceCatalog(device.device_type) ?? getDeviceCatalog('UAH')!;
    this.uda = device;
    this._hkDpsState = hubDpsState(this);
    this._hkLockState = hubLockState(this);
    this._hkSideDoorDpsState = hubDpsState(this, true);
    this._hkSideDoorLockState = hubLockState(this, true);
    this.gateDirection = null;
    this.gateDirectionDuration = ((this.getFeatureNumber('Hub.GateDirectionDuration') ?? ACCESS_GATE_DIRECTION_DURATION) * 1000);
    this.gateDirectionUntil = 0;
    this.gatePhaseTimers = [];
    this.gateTransitionUntil = 0;
    this.lockDelayInterval = this.getFeatureNumber('Hub.LockDelayInterval') ?? undefined;
    this.mainDoorLocationId = undefined;
    this.mainDoorName = undefined;
    this.sideDoorLocationId = undefined;
    this.sideDoorName = undefined;
    this.sideDoorGateTransitionUntil = 0;
    this.doorbellRingRequestId = null;

    // If we attempt to set the delay interval to something invalid, then assume we are using the default unlock behavior.
    if((this.lockDelayInterval !== undefined) && (this.lockDelayInterval < 0)) {

      this.lockDelayInterval = undefined;
    }

    this.configureHints();
    this.configureDevice();
  }

  // Configure device-specific settings for this device.
  protected configureHints(): boolean {

    // Configure our parent's hints.
    super.configureHints();

    this.hints.hasSideDoor = this.catalog.supportsSideDoor && this.hasFeature('Hub.SideDoor');
    this.hints.hasWiringDps = this.catalog.hasDps && this.hasFeature('Hub.DPS');
    this.hints.hasWiringRel = this.catalog.hasRel && this.hasFeature('Hub.REL');
    this.hints.hasWiringRen = this.catalog.hasRen && this.hasFeature('Hub.REN');
    this.hints.hasWiringRex = this.catalog.hasRex && this.hasFeature('Hub.REX');
    this.hints.hasWiringSideDoorDps = this.hints.hasSideDoor && this.hasFeature('Hub.SideDoor.DPS');
    this.hints.logDoorbell = this.hasFeature('Log.Doorbell');
    this.hints.logDps = this.hasFeature('Log.DPS');
    this.hints.logLock = this.hasFeature('Log.Lock');
    this.hints.logRel = this.hasFeature('Log.REL');
    this.hints.logRen = this.hasFeature('Log.REN');
    this.hints.logRex = this.hasFeature('Log.REX');

    // Proxy mode devices have a single terminal input that's selectable between DPS and REX modes.
    if(this.catalog.usesProxyMode) {

      checkUltraInputs(this);
    }

    return true;
  }

  // Override to prefer the door name over the device alias for UA Gate hubs.
  public override get resolvedName(): string | undefined {

    return this.mainDoorName ?? this.uda.alias;
  }

  // Configure the device information details for HomeKit. Overrides the base class to prefer the door name over the device alias for UA Gate hubs.
  public configureInfo(): boolean {

    if(this.hints.syncName) {

      const name = this.mainDoorName ?? this.uda.alias;

      if(name) {

        this.accessoryName = name;
      }
    }

    updateSideDoorServiceNames(this);

    return this.setInfo(this.accessory, this.uda);
  }

  // Clear any scheduled gate phase transition timers.
  public clearGatePhaseTimers(): void {

    for(const timer of this.gatePhaseTimers) {

      clearTimeout(timer);
    }

    this.gatePhaseTimers = [];
  }

  // Initialize and configure the hub accessory for HomeKit. Orchestrates all module setup.
  private configureDevice(): boolean {

    this._hkLockState = hubLockState(this);
    this._hkSideDoorDpsState = hubDpsState(this, true);
    this._hkSideDoorLockState = hubLockState(this, true);

    // Clean out the context object in case it's been polluted somehow.
    this.accessory.context = {};
    this.accessory.context.mac = this.uda.mac;
    this.accessory.context.controller = this.controller.uda.host.mac;

    // Discover door names for UA Gate hubs early so log messages and services can use real names.
    if(this.catalog.usesLocationApi) {

      discoverDoorNames(this);
    }

    logLockDelayInterval(this, this.mainDoorName ?? 'door');

    if(this.hints.hasSideDoor) {

      logLockDelayInterval(this, this.sideDoorName ?? 'side door');
    }

    // Configure accessory information.
    this.configureInfo();

    // Register state-change reaction handlers on the event bus (must be done before services so reactions are ready).
    registerServiceReactions(this);

    // Configure all HomeKit services.
    configureServices(this);

    // Configure MQTT services (includes its own event bus subscriptions).
    configureMqtt(this);

    // Initialize door states from API bootstrap data (must be done after services are configured, before event handlers).
    if(this.catalog.usesLocationApi) {

      initializeDoorsFromApi(this);
    }

    // Register external event handlers (subscribes to controller events).
    registerEventHandlers(this);

    return true;
  }

  // HomeKit DPS state property accessor. Reads from the contact sensor service if available, otherwise falls back to the backing variable.
  public get hkDpsState(): CharacteristicValue {

    const service = this.accessory.getServiceById(this.hap.Service.ContactSensor, AccessReservedNames.CONTACT_DPS);

    if(service) {

      return service.getCharacteristic(this.hap.Characteristic.ContactSensorState).value ?? this._hkDpsState;
    }

    return this._hkDpsState;
  }

  // HomeKit DPS state setter. Updates the backing variable, contact sensor, and emits events.
  public set hkDpsState(value: CharacteristicValue) {

    const isClosed = value === this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;

    // Suppress contradictory DPS events during gate movement (e.g. sensor bounce as the gate moves past).
    if(this.gateDirection && (Date.now() < this.gateDirectionUntil)) {

      if((this.gateDirection === 'opening' && isClosed) || (this.gateDirection === 'closing' && !isClosed)) {

        this.log.debug('Gate DPS bounce suppressed: %s during %s phase.', isClosed ? 'close' : 'open', this.gateDirection);

        return;
      }
    }

    // Detect gate closing: DPS transitions from open to close during the "open" phase (gate closing earlier than the timer predicted) or after the
    // direction window expires (self-closing with no active cycle). Cancel phase timers and set closing direction to suppress bounce.
    if(this.catalog.usesLocationApi && isClosed && (this._hkDpsState !== value) && (this.gateDirection === 'open' || (Date.now() >= this.gateDirectionUntil))) {

      this.log.debug('Gate closing detected during %s phase — transitioning to Closing.', this.gateDirection ?? 'idle');
      this.clearGatePhaseTimers();
      this.gateDirection = 'closing';
      this.gateDirectionUntil = Date.now() + (this.gateDirectionDuration / 3);

      const gdoService = this.accessory.getService(this.hap.Service.GarageDoorOpener);

      if(gdoService) {

        gdoService.updateCharacteristic(this.hap.Characteristic.TargetDoorState, this.hap.Characteristic.TargetDoorState.CLOSED);
        gdoService.updateCharacteristic(this.hap.Characteristic.CurrentDoorState, this.hap.Characteristic.CurrentDoorState.CLOSING);
      }
    }

    this._hkDpsState = value;
    setContactSensorState(this, AccessReservedNames.CONTACT_DPS, value);

    // Emit events for DPS and sensor changes.
    this.hubEvents.emit('dps:changed', { isSideDoor: false, value });
    this.hubEvents.emit('sensor:changed', { input: 'Dps' as SensorInput, value });
  }

  // HomeKit lock state property accessor.
  public get hkLockState(): CharacteristicValue {

    return this._hkLockState;
  }

  // HomeKit lock state setter. Updates the backing variable and emits the lock:changed event.
  public set hkLockState(value: CharacteristicValue) {

    // Update the lock state.
    this._hkLockState = value;

    // Emit the lock:changed event - service reactions and MQTT will handle the rest.
    this.hubEvents.emit('lock:changed', { isSideDoor: false, value });
  }

  // HomeKit side door lock state property accessor.
  public get hkSideDoorLockState(): CharacteristicValue {

    return this._hkSideDoorLockState;
  }

  // HomeKit side door lock state setter. Updates the backing variable and emits the lock:changed event.
  public set hkSideDoorLockState(value: CharacteristicValue) {

    // Update the lock state.
    this._hkSideDoorLockState = value;

    // Emit the lock:changed event - service reactions and MQTT will handle the rest.
    this.hubEvents.emit('lock:changed', { isSideDoor: true, value });
  }

  // We dynamically define our getters and setters for terminal inputs so we can streamline redundancies.
  static {

    // Define wiring getters for all sensor inputs.
    for(const input of sensorInputs) {

      Object.defineProperty(AccessHub.prototype, 'is' + input + 'Wired', {

        configurable: true,
        enumerable: true,
        get(this: AccessHub) {

          return isWired(this, input);
        },
      });
    }

    // Define hk*State getters and setters. We skip DPS since we implement it with a manual getter/setter that provides fallback behavior when the
    // DPS contact sensor is disabled.
    for(const input of sensorInputs.filter(i => i !== 'Dps')) {

      const enumKey = 'CONTACT_' + input.toUpperCase();

      Object.defineProperty(AccessHub.prototype, 'hk' + input + 'State', {

        configurable: true,
        enumerable: true,
        get(this: AccessHub) {

          return getContactSensorState(this, AccessReservedNames[enumKey as keyof typeof AccessReservedNames]);
        },

        set(this: AccessHub, value: CharacteristicValue) {

          setContactSensorState(this, AccessReservedNames[enumKey as keyof typeof AccessReservedNames], value);

          // Emit sensor:changed event for MQTT and logging.
          this.hubEvents.emit('sensor:changed', { input: input as SensorInput, value });
        },
      });
    }
  }
}
