/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * access-hub.ts: Core hub class for UniFi Access. State management, construction, orchestration, and static property definitions.
 */
import { EventEmitter } from "events";
import type { AccessDeviceConfig } from "unifi-access";
import type { CharacteristicValue, PlatformAccessory } from "homebridge";
import { type DeviceCatalogEntry, type SensorInput, getDeviceCatalog } from "../access-device-catalog.js";
import type { AccessController } from "../access-controller.js";
import { AccessDevice } from "../access-device.js";
import { AccessReservedNames } from "../access-types.js";
import { type AccessHubHKProps, type AccessHubWiredProps, type HubEventKey, type HubEventMap, type KeyOf, sensorInputs } from "./access-hub-types.js";
import { discoverDoorIds } from "./access-hub-api.js";
import { registerEventHandlers } from "./access-hub-events.js";
import { configureMqtt } from "./access-hub-mqtt.js";
import { configureServices, registerServiceReactions } from "./access-hub-services.js";
import {
  checkUltraInputs, getContactSensorState, hubDpsState, hubLockState, isWired, logLockDelayInterval, setContactSensorState
} from "./access-hub-utils.js";

// Merge the declarations into the definition of the class, so TypeScript knows that these properties will exist.
export interface AccessHub extends AccessHubHKProps, AccessHubWiredProps { }

// Key-union types that reference AccessHub must stay here due to the circular dependency with the class definition.
export type HkStateKey = KeyOf<AccessHub, "hk", "State">;

// Typed event emitter wrapper for the hub event bus.
class HubEventBus {

  private readonly emitter = new EventEmitter();

  emit<K extends HubEventKey>(event: K, data: HubEventMap[K]): void {

    this.emitter.emit(event, data);
  }

  on<K extends HubEventKey>(event: K, handler: (data: HubEventMap[K]) => void): void {

    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }
}

export class AccessHub extends AccessDevice {

  // State backing fields - public for module access.
  public _hkDpsState: CharacteristicValue;
  public _hkLockState: CharacteristicValue;
  public _hkSideDoorDpsState: CharacteristicValue;
  public _hkSideDoorLockState: CharacteristicValue;

  // Device configuration - public for module access.
  public readonly catalog: DeviceCatalogEntry;
  public doorbellRingRequestId: string | null;
  public gateTransitionUntil: number;
  public lockDelayInterval: number | undefined;
  public mainDoorLocationId: string | undefined;
  public sideDoorLocationId: string | undefined;
  public sideDoorGateTransitionUntil: number;
  public uda: AccessDeviceConfig;

  // Internal event bus for state-change reactions.
  public readonly hubEvents = new HubEventBus();

  // Create an instance.
  constructor(controller: AccessController, device: AccessDeviceConfig, accessory: PlatformAccessory) {

    super(controller, accessory);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.catalog = getDeviceCatalog(device.device_type) ?? getDeviceCatalog("UAH")!;
    this.uda = device;
    this._hkDpsState = hubDpsState(this);
    this._hkLockState = hubLockState(this);
    this._hkSideDoorDpsState = hubDpsState(this, true);
    this._hkSideDoorLockState = hubLockState(this, true);
    this.gateTransitionUntil = 0;
    this.lockDelayInterval = this.getFeatureNumber("Hub.LockDelayInterval") ?? undefined;
    this.mainDoorLocationId = undefined;
    this.sideDoorLocationId = undefined;
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

    this.hints.hasSideDoor = this.catalog.supportsSideDoor && this.hasFeature("Hub.SideDoor");
    this.hints.hasWiringDps = this.catalog.hasDps && this.hasFeature("Hub.DPS");
    this.hints.hasWiringRel = this.catalog.hasRel && this.hasFeature("Hub.REL");
    this.hints.hasWiringRen = this.catalog.hasRen && this.hasFeature("Hub.REN");
    this.hints.hasWiringRex = this.catalog.hasRex && this.hasFeature("Hub.REX");
    this.hints.hasWiringSideDoorDps = this.hints.hasSideDoor && this.hasFeature("Hub.SideDoor.DPS");
    this.hints.logDoorbell = this.hasFeature("Log.Doorbell");
    this.hints.logDps = this.hasFeature("Log.DPS");
    this.hints.logLock = this.hasFeature("Log.Lock");
    this.hints.logRel = this.hasFeature("Log.REL");
    this.hints.logRen = this.hasFeature("Log.REN");
    this.hints.logRex = this.hasFeature("Log.REX");

    // Proxy mode devices have a single terminal input that's selectable between DPS and REX modes.
    if(this.catalog.usesProxyMode) {

      checkUltraInputs(this);
    }

    return true;
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

    logLockDelayInterval(this, "door");

    if(this.hints.hasSideDoor) {

      logLockDelayInterval(this, "side door");
    }

    // Configure accessory information.
    this.configureInfo();

    // Register state-change reaction handlers on the event bus (must be done before services so reactions are ready).
    registerServiceReactions(this);

    // Configure all HomeKit services.
    configureServices(this);

    // Configure MQTT services (includes its own event bus subscriptions).
    configureMqtt(this);

    // Discover door IDs for UA Gate hubs (must be done before registering event handlers so door IDs are available).
    if(this.catalog.usesLocationApi) {

      discoverDoorIds(this);
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

    this._hkDpsState = value;
    setContactSensorState(this, AccessReservedNames.CONTACT_DPS, value);

    // Emit events for DPS and sensor changes.
    this.hubEvents.emit("dps:changed", { isSideDoor: false, value });
    this.hubEvents.emit("sensor:changed", { input: "Dps" as SensorInput, value });
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
    this.hubEvents.emit("lock:changed", { isSideDoor: false, value });
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
    this.hubEvents.emit("lock:changed", { isSideDoor: true, value });
  }

  // We dynamically define our getters and setters for terminal inputs so we can streamline redundancies.
  static {

    // Define wiring getters for all sensor inputs.
    for(const input of sensorInputs) {

      Object.defineProperty(AccessHub.prototype, "is" + input + "Wired", {

        configurable: true,
        enumerable: true,
        get(this: AccessHub) {

          return isWired(this, input);
        }
      });
    }

    // Define hk*State getters and setters. We skip DPS since we implement it with a manual getter/setter that provides fallback behavior when the DPS contact sensor
    // is disabled.
    for(const input of sensorInputs.filter(i => i !== "Dps")) {

      const enumKey = "CONTACT_" + input.toUpperCase();

      Object.defineProperty(AccessHub.prototype, "hk" + input + "State", {

        configurable: true,
        enumerable: true,
        get(this: AccessHub) {

          return getContactSensorState(this, AccessReservedNames[enumKey as keyof typeof AccessReservedNames]);
        },

        set(this: AccessHub, value: CharacteristicValue) {

          setContactSensorState(this, AccessReservedNames[enumKey as keyof typeof AccessReservedNames], value);

          // Emit sensor:changed event for MQTT and logging.
          this.hubEvents.emit("sensor:changed", { input: input as SensorInput, value });
        }
      });
    }
  }
}
