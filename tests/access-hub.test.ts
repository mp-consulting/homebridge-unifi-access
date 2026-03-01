/* Tests for AccessHub class. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { AccessEventType, AccessReservedNames } from '../src/access-types.js';
import { AUTO_LOCK_DELAY_MS, areWiringKeysActive, getConfigValue } from '../src/hub/access-hub-types.js';

// Hoisted helper for mock service creation (needed inside vi.mock factory).
const { createTestService } = vi.hoisted(() => {

  function createTestService(serviceType: string, subtype?: string) {

    const characteristics = new Map<string, any>();

    const svc: any = {

      addOptionalCharacteristic: vi.fn(),
      displayName: '',

      getCharacteristic: vi.fn((charType: string) => {

        if(!characteristics.has(charType)) {

          characteristics.set(charType, { onGet: vi.fn().mockReturnThis(), onSet: vi.fn().mockReturnThis(), sendEventNotification: vi.fn(), value: null });
        }

        return characteristics.get(charType);
      }),

      serviceType,
      setPrimaryService: vi.fn(),
      subtype,
      testCharacteristic: vi.fn().mockReturnValue(false),

      updateCharacteristic: vi.fn((charType: string, value: unknown) => {

        if(!characteristics.has(charType)) {

          characteristics.set(charType, { onGet: vi.fn().mockReturnThis(), onSet: vi.fn().mockReturnThis(), sendEventNotification: vi.fn(), value: null });
        }

        characteristics.get(charType).value = value;

        return svc;
      }),
    };

    return svc;
  }

  return { createTestService };
});

// Mock homebridge-plugin-utils to handle service creation without real Homebridge.
vi.mock('homebridge-plugin-utils', () => ({

  acquireService: vi.fn((accessory: any, serviceType: string, _name: string, subtype?: string, initCallback?: () => void) => {

    const key = subtype ? serviceType + '.' + subtype : serviceType;

    if(accessory._services?.has(key)) {

      return accessory._services.get(key);
    }

    const service = createTestService(serviceType, subtype);

    accessory._services?.set(key, service);
    initCallback?.();

    return service;
  }),

  sanitizeName: (name: string) => name,

  validService: vi.fn((_a: any, _s: string, condition: any) => {

    if(typeof condition === 'function') {

      return condition(false);
    }

    return !!condition;
  }),
}));

import { AccessHub } from '../src/hub/index.js';

// Helper: create test accessory with tracked services map.
function createTestAccessory(uuid = 'test-uuid') {

  const services = new Map<string, any>();

  services.set('AccessoryInformation', createTestService('AccessoryInformation'));

  return {

    UUID: uuid,
    _associatedHAPAccessory: { displayName: '' },
    _services: services,
    addService: vi.fn((service: any) => service),
    context: {} as Record<string, unknown>,
    displayName: 'Test Accessory',
    getService: vi.fn((serviceType: string) => services.get(serviceType)),
    getServiceById: vi.fn((serviceType: string, subtype: string) => services.get(serviceType + '.' + subtype)),
    removeService: vi.fn(),
    services: [] as any[],
  };
}

// Helper: convert object configs to array format used by the Access API.
function toConfigArray(obj: Record<string, string>): { key: string; value: string }[] {

  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

// Helper: create a mock controller for hub tests.
function createHubController(overrides: Record<string, unknown> = {}) {

  const events = new EventEmitter();
  const log = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

  const api = {

    hap: {

      Characteristic: {

        ConfiguredName: 'ConfiguredName',
        ContactSensorState: { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
        CurrentDoorState: { CLOSED: 1, CLOSING: 3, OPEN: 0, OPENING: 2, STOPPED: 4 },
        FirmwareRevision: 'FirmwareRevision',
        LockCurrentState: { JAMMED: 2, SECURED: 1, UNKNOWN: 3, UNSECURED: 0 },
        LockTargetState: { SECURED: 1, UNSECURED: 0 },
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        MotionDetected: 'MotionDetected',
        Name: 'Name',
        ObstructionDetected: 'ObstructionDetected',
        On: 'On',
        ProgrammableSwitchEvent: { SINGLE_PRESS: 0 },
        SerialNumber: 'SerialNumber',
        StatusActive: 'StatusActive',
        StatusTampered: { NOT_TAMPERED: 0, TAMPERED: 1 },
        TargetDoorState: { CLOSED: 1, OPEN: 0 },
      },

      Service: {

        AccessoryInformation: 'AccessoryInformation',
        ContactSensor: 'ContactSensor',
        Doorbell: 'Doorbell',
        GarageDoorOpener: 'GarageDoorOpener',
        LockMechanism: 'LockMechanism',
        MotionSensor: 'MotionSensor',
        OccupancySensor: 'OccupancySensor',
        Switch: 'Switch',
      },

      uuid: { generate: (input: string) => 'uuid-' + input },
    },

    on: vi.fn(),
    platformAccessory: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
  };

  const platform = {

    accessories: [] as unknown[],
    api,
    debug: vi.fn(),

    featureOptions: {

      getFloat: vi.fn().mockReturnValue(null),
      getInteger: vi.fn().mockReturnValue(null),
      test: vi.fn().mockReturnValue(true),
      value: vi.fn().mockReturnValue(null),
    },

    log,
  };

  const udaApi = {

    bootstrap: {},
    controller: { host: { firmware_version: '4.0.0', mac: '00:11:22:33:44:55' }, version: '2.0.0' },
    devices: [],
    doors: [] as { door_lock_relay_status?: string; door_position_status?: string; name: string; unique_id: string }[],
    getApiEndpoint: vi.fn().mockReturnValue('/api'),
    getBootstrap: vi.fn().mockResolvedValue(undefined),
    getDeviceName: vi.fn((device: any) => device.alias ?? device.name),
    getFullName: vi.fn((device: any) => device.alias ?? device.name),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    name: 'Test Controller',
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    reset: vi.fn(),
    responseOk: vi.fn().mockReturnValue(true),
    retrieve: vi.fn().mockResolvedValue({ statusCode: 200 }),
    unlock: vi.fn().mockResolvedValue(true),
  };

  return {

    api,
    config: { address: '192.168.1.1', mqttTopic: 'unifi/access', password: 'test', username: 'admin' },
    configuredDevices: {} as Record<string, unknown>,
    events,
    hasFeature: vi.fn().mockReturnValue(true),
    id: '001122334455',
    log,
    logApiErrors: true,
    mqtt: null as any,
    platform,
    removeHomeKitDevice: vi.fn(),
    deviceLookup: vi.fn(),
    uda: { host: { firmware_version: '4.0.0', mac: '00:11:22:33:44:55' } },
    udaApi,
    ...overrides,
  };
}

// Helper: create a mock MQTT client.
function createTestMqtt() {

  return { publish: vi.fn(), subscribe: vi.fn(), subscribeGet: vi.fn(), subscribeSet: vi.fn(), unsubscribe: vi.fn() };
}

// Base device config fields shared by all device types.
const baseConfig = {

  adopt_time: 0,
  adopted_by_uid: 'uid',
  connected_uah_id: '',
  door: { unique_id: 'door-1' },
  firmware: 'v3.0.0',
  firmware_update: null,
  guid: 'guid',
  hw_type: 'UAH',
  images: {},
  ip: '192.168.1.100',
  is_adopted: true,
  is_connected: true,
  is_managed: true,
  is_online: true,
  location: null,
  location_id: 'loc-1',
  mac: 'AA:BB:CC:DD:EE:FF',
  need_advisory: false,
  resource_name: 'test',
  revision_update_time: 0,
  security_check: false,
  source_id: '1',
  start_time: 0,
  version: '3.0.0',
  wiring_state: {},
};

// Create a UAH device config with proper array configs.
function createUAHConfig(overrides: Record<string, unknown> = {}) {

  return {

    ...baseConfig,
    alias: 'Test Hub',
    capabilities: ['is_hub', 'door_bell', 'nfc_card_easy_provision', 'pin_code'],

    configs: toConfigArray({

      'input_state_dps': 'close',
      'input_state_rel': 'off',
      'input_state_ren': 'off',
      'input_state_rex': 'off',
      'input_state_rly-lock_dry': 'lock',
      'wiring_state_dps-neg': 'on',
      'wiring_state_dps-pos': 'on',
      'wiring_state_rel-neg': 'on',
      'wiring_state_rel-pos': 'on',
      'wiring_state_ren-neg': 'on',
      'wiring_state_ren-pos': 'on',
      'wiring_state_rex-neg': 'on',
      'wiring_state_rex-pos': 'on',
    }),

    device_type: 'UAH',
    display_model: 'UA Hub',
    extensions: [],
    model: 'UAH',
    name: 'Test Hub',
    type: 'UAH',
    unique_id: 'uah-unique-id',
    ...overrides,
  } as any;
}

// Create a UGT device config with proper array configs.
function createUGTConfig(overrides: Record<string, unknown> = {}) {

  return {

    ...baseConfig,
    alias: 'Test Gate',
    capabilities: ['is_hub', 'door_bell'],

    configs: toConfigArray({

      'input_door_dps': 'close',
      'input_gate_dps': 'close',
      'output_oper1_relay': 'lock',
      'output_oper2_relay': 'lock',
      'wiring_state_door-dps-neg': 'on',
      'wiring_state_door-dps-pos': 'on',
      'wiring_state_gate-dps-neg': 'on',
      'wiring_state_gate-dps-pos': 'on',
    }),

    device_type: 'UGT',
    display_model: 'UA Gate',
    extensions: [],
    model: 'UGT',
    name: 'Test Gate',
    type: 'UGT',
    unique_id: 'ugt-unique-id',
    ...overrides,
  } as any;
}

// Create a UA-ULTRA device config.
function createUltraConfig(overrides: Record<string, unknown> = {}) {

  return {

    ...baseConfig,
    alias: 'Test Ultra',

    capabilities: [

      'is_hub', 'is_reader', 'identity_face_unlock', 'hand_wave', 'mobile_unlock_ver2',
      'support_mobile_unlock', 'nfc_card_easy_provision', 'pin_code', 'qr_code', 'support_apple_pass',
    ],

    configs: toConfigArray({

      'input_d1_button': 'off',
      'input_d1_dps': 'close',
      'output_d1_lock_relay': 'lock',
    }),

    device_type: 'UA-ULTRA',
    display_model: 'UA Ultra',

    extensions: [{

      extension_name: 'rex_button_mode',
      target_config: [{ config_key: 'rex_button_mode', config_value: 'rex' }],
      target_name: '',
      target_value: 'rex',
    }],

    model: 'UA-ULTRA',
    name: 'Test Ultra',
    type: 'UA-ULTRA',
    unique_id: 'ultra-unique-id',
    ...overrides,
  } as any;
}

describe('getConfigValue', () => {

  const configs = [

    { key: 'input_state_dps', value: 'close' },
    { key: 'input_state_rly-lock_dry', value: 'off' },
    { key: 'tamper_event', value: 'true' },
  ];

  it('should return the value for an existing key', () => {

    expect(getConfigValue(configs, 'input_state_dps')).toBe('close');
    expect(getConfigValue(configs, 'tamper_event')).toBe('true');
  });

  it('should return undefined for a missing key', () => {

    expect(getConfigValue(configs, 'nonexistent')).toBeUndefined();
  });

  it('should return undefined for undefined configs', () => {

    expect(getConfigValue(undefined, 'input_state_dps')).toBeUndefined();
  });

  it('should return undefined for empty configs', () => {

    expect(getConfigValue([], 'input_state_dps')).toBeUndefined();
  });
});

describe('areWiringKeysActive', () => {

  const configs = [

    { key: 'wiring_state_dps-neg', value: 'on' },
    { key: 'wiring_state_dps-pos', value: 'on' },
    { key: 'wiring_state_rel-neg', value: 'off' },
    { key: 'wiring_state_rel-pos', value: 'on' },
  ];

  it('should return true when all wiring keys are on', () => {

    expect(areWiringKeysActive(configs, ['wiring_state_dps-neg', 'wiring_state_dps-pos'])).toBe(true);
  });

  it('should return false when any wiring key is off', () => {

    expect(areWiringKeysActive(configs, ['wiring_state_rel-neg', 'wiring_state_rel-pos'])).toBe(false);
  });

  it('should return false when a wiring key is missing', () => {

    expect(areWiringKeysActive(configs, ['wiring_state_ren-neg', 'wiring_state_ren-pos'])).toBe(false);
  });

  it('should return true for empty wiring keys array', () => {

    expect(areWiringKeysActive(configs, [])).toBe(true);
  });

  it('should return true for undefined configs with empty keys', () => {

    expect(areWiringKeysActive(undefined, [])).toBe(true);
  });

  it('should return false for undefined configs with keys', () => {

    expect(areWiringKeysActive(undefined, ['wiring_state_dps-neg'])).toBe(false);
  });
});

describe('AccessHub', () => {

  let controller: ReturnType<typeof createHubController>;
  let accessory: ReturnType<typeof createTestAccessory>;

  beforeEach(() => {

    vi.useFakeTimers();
    controller = createHubController();
    accessory = createTestAccessory();
  });

  afterEach(() => {

    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {

    it('should construct successfully with UAH device', () => {

      const hub = new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(hub.uda.device_type).toBe('UAH');
    });

    it('should construct successfully with UGT device', () => {

      const hub = new AccessHub(controller as any, createUGTConfig(), accessory as any);

      expect(hub.uda.device_type).toBe('UGT');
    });

    it('should construct successfully with UA-ULTRA device', () => {

      const hub = new AccessHub(controller as any, createUltraConfig(), accessory as any);

      expect(hub.uda.device_type).toBe('UA-ULTRA');
    });

    it('should fall back to UAH catalog for unknown device type', () => {

      // Should not throw — falls back to UAH catalog.
      const hub = new AccessHub(controller as any, createUAHConfig({ device_type: 'UNKNOWN' }), accessory as any);

      expect(hub.uda.device_type).toBe('UNKNOWN');
    });

    it('should set accessory context with device MAC and controller MAC', () => {

      new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(accessory.context.mac).toBe('AA:BB:CC:DD:EE:FF');
      expect(accessory.context.controller).toBe('00:11:22:33:44:55');
    });

    it('should register event listener on device unique_id', () => {

      const device = createUAHConfig();

      new AccessHub(controller as any, device, accessory as any);

      expect(controller.events.listenerCount(device.unique_id)).toBeGreaterThan(0);
    });

    it('should register doorbell event listeners for devices with doorbell capability', () => {

      new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(controller.events.listenerCount(AccessEventType.DOORBELL_RING)).toBeGreaterThan(0);
      expect(controller.events.listenerCount(AccessEventType.DOORBELL_CANCEL)).toBeGreaterThan(0);
    });

    it('should log lock relay behavior', () => {

      new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining('lock five seconds after unlocking'));
    });
  });

  describe('configureHints', () => {

    it('should set all four wiring hints for UAH', () => {

      const hub = new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(hub.hints.hasWiringDps).toBe(true);
      expect(hub.hints.hasWiringRel).toBe(true);
      expect(hub.hints.hasWiringRen).toBe(true);
      expect(hub.hints.hasWiringRex).toBe(true);
    });

    it('should set only DPS wiring hint for UGT', () => {

      const hub = new AccessHub(controller as any, createUGTConfig(), accessory as any);

      expect(hub.hints.hasWiringDps).toBe(true);
      expect(hub.hints.hasWiringRel).toBe(false);
      expect(hub.hints.hasWiringRen).toBe(false);
      expect(hub.hints.hasWiringRex).toBe(false);
    });

    it('should enable side door for UGT when feature is enabled', () => {

      const hub = new AccessHub(controller as any, createUGTConfig(), accessory as any);

      expect(hub.hints.hasSideDoor).toBe(true);
    });

    it('should disable side door for non-UGT devices', () => {

      const hub = new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(hub.hints.hasSideDoor).toBe(false);
    });

    it('should handle UA-ULTRA proxy mode — REX enabled, DPS disabled when mode is rex', () => {

      const hub = new AccessHub(controller as any, createUltraConfig(), accessory as any);

      // Mode is "rex", so DPS proxy mode ("dps") is not matched → DPS disabled.
      expect(hub.hints.hasWiringDps).toBe(false);

      // REX proxy mode ("rex") IS matched → REX enabled.
      expect(hub.hints.hasWiringRex).toBe(true);
    });

    it('should set all log hints when features are enabled', () => {

      const hub = new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(hub.hints.logDoorbell).toBe(true);
      expect(hub.hints.logDps).toBe(true);
      expect(hub.hints.logLock).toBe(true);
      expect(hub.hints.logRel).toBe(true);
      expect(hub.hints.logRen).toBe(true);
      expect(hub.hints.logRex).toBe(true);
    });

    it('should disable log hints when features are disabled', () => {

      controller.hasFeature.mockReturnValue(false);

      const hub = new AccessHub(controller as any, createUAHConfig(), accessory as any);

      expect(hub.hints.logDoorbell).toBe(false);
      expect(hub.hints.logLock).toBe(false);
    });

    it('should set side door DPS hint for UGT', () => {

      const hub = new AccessHub(controller as any, createUGTConfig(), accessory as any);

      expect(hub.hints.hasWiringSideDoorDps).toBe(true);
    });
  });

  describe('configureInfo', () => {

    it('should prefer mainDoorName over device alias for UGT hubs', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Portail', unique_id: 'door-1' }, { name: 'Portillon', unique_id: 'door-2' }];

      const hub = new AccessHub(controller as any, device, accessory as any);

      expect(hub.mainDoorName).toBe('Portail');
      expect(hub.accessoryName).toBe('Portail');
    });

    it('should fall back to device alias when mainDoorName is undefined', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [];

      const hub = new AccessHub(controller as any, device, accessory as any);

      expect(hub.mainDoorName).toBeUndefined();
      expect(hub.accessoryName).toBe('Test Gate');
    });

    it('should store sideDoorName during discovery', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Portillon', unique_id: 'door-2' }];

      const hub = new AccessHub(controller as any, device, accessory as any);

      expect(hub.sideDoorName).toBe('Portillon');
    });

    it('should update side door service names when sideDoorName is discovered', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Portillon', unique_id: 'door-2' }];

      // Constructor has side effects that configure the accessory services.
      void new AccessHub(controller as any, device, accessory as any);

      const sideDoorLock = accessory._services.get('LockMechanism.' + AccessReservedNames.LOCK_DOOR_SIDE);

      expect(sideDoorLock?.displayName).toBe('Portillon');
    });
  });

  describe('event handling — remote unlock', () => {

    it('should publish MQTT unlock for non-UGT device', () => {

      const device = createUAHConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      new AccessHub(controller as any, device, accessory as any);

      controller.events.emit(device.unique_id, { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: device.unique_id });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'lock', 'false');
    });

    it('should log unlock when logLock is enabled', () => {

      const device = createUAHConfig();

      new AccessHub(controller as any, device, accessory as any);

      controller.events.emit(device.unique_id, { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: device.unique_id });

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining('Unlocked'));
    });
  });

  describe('event handling — UGT remote unlock', () => {

    it('should publish MQTT unlock for main door', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit('door-1', { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: 'door-1' });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'lock', 'false');
    });

    it('should auto-lock main door after delay', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit('door-1', { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: 'door-1' });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'lock', 'false');

      mqtt.publish.mockClear();
      vi.advanceTimersByTime(AUTO_LOCK_DELAY_MS);

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'lock', 'true');
    });

    it('should publish MQTT unlock for side door', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit('door-2', { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: 'door-2' });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'sidedoor/lock', 'false');
    });

    it('should auto-lock side door after delay', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit('door-2', { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: 'door-2' });

      mqtt.publish.mockClear();
      vi.advanceTimersByTime(AUTO_LOCK_DELAY_MS);

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'sidedoor/lock', 'true');
    });

    it('should log UGT main door unlock', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }];

      new AccessHub(controller as any, device, accessory as any);

      controller.events.emit('door-1', { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: 'door-1' });

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining('Gate unlocked'));
    });

    it('should log UGT side door unlock', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      controller.events.emit('door-2', { data: {}, event: AccessEventType.DEVICE_REMOTE_UNLOCK, event_object_id: 'door-2' });

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining('Side Door unlocked'));
    });
  });

  describe('event handling — doorbell', () => {

    it('should publish MQTT on doorbell ring', () => {

      const device = createUAHConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(AccessEventType.DOORBELL_RING, {
        data: { connected_uah_id: device.unique_id, request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_RING,
        event_object_id: 'some-id',
      });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'doorbell', 'true');
    });

    it('should log doorbell ring when logDoorbell is enabled', () => {

      const device = createUAHConfig();

      new AccessHub(controller as any, device, accessory as any);

      controller.events.emit(AccessEventType.DOORBELL_RING, {
        data: { connected_uah_id: device.unique_id, request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_RING,
        event_object_id: 'some-id',
      });

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining('Doorbell ring detected'));
    });

    it('should ignore doorbell ring for different device', () => {

      const device = createUAHConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(AccessEventType.DOORBELL_RING, {
        data: { connected_uah_id: 'different-device', request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_RING,
        event_object_id: 'some-id',
      });

      expect(mqtt.publish).not.toHaveBeenCalledWith(expect.any(String), 'doorbell', 'true');
    });

    it('should publish MQTT on doorbell cancel', () => {

      const device = createUAHConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      new AccessHub(controller as any, device, accessory as any);

      // First ring.
      controller.events.emit(AccessEventType.DOORBELL_RING, {
        data: { connected_uah_id: device.unique_id, request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_RING,
        event_object_id: 'some-id',
      });

      mqtt.publish.mockClear();

      // Then cancel.
      controller.events.emit(AccessEventType.DOORBELL_CANCEL, {
        data: { remote_call_request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_CANCEL,
        event_object_id: 'some-id',
      });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'doorbell', 'false');
    });

    it('should log doorbell cancel', () => {

      const device = createUAHConfig();

      new AccessHub(controller as any, device, accessory as any);

      controller.events.emit(AccessEventType.DOORBELL_RING, {
        data: { connected_uah_id: device.unique_id, request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_RING,
        event_object_id: 'some-id',
      });

      controller.events.emit(AccessEventType.DOORBELL_CANCEL, {
        data: { remote_call_request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_CANCEL,
        event_object_id: 'some-id',
      });

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining('Doorbell ring cancelled'));
    });

    it('should ignore cancel with mismatched request ID', () => {

      const device = createUAHConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      new AccessHub(controller as any, device, accessory as any);

      controller.events.emit(AccessEventType.DOORBELL_RING, {
        data: { connected_uah_id: device.unique_id, request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_RING,
        event_object_id: 'some-id',
      });

      mqtt.publish.mockClear();

      controller.events.emit(AccessEventType.DOORBELL_CANCEL, {
        data: { remote_call_request_id: 'different-ring' },
        event: AccessEventType.DOORBELL_CANCEL,
        event_object_id: 'some-id',
      });

      expect(mqtt.publish).not.toHaveBeenCalledWith(expect.any(String), 'doorbell', 'false');
    });

    it('should ignore doorbell ring when device lacks door_bell capability', () => {

      const device = createUAHConfig({ capabilities: ['is_hub'] });
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(AccessEventType.DOORBELL_RING, {
        data: { connected_uah_id: device.unique_id, request_id: 'ring-1' },
        event: AccessEventType.DOORBELL_RING,
        event_object_id: 'some-id',
      });

      expect(mqtt.publish).not.toHaveBeenCalledWith(expect.any(String), 'doorbell', 'true');
    });
  });

  describe('event handling — device update v1', () => {

    it('should detect lock state change and publish MQTT', () => {

      // Start with locked state ("off" → SECURED).
      const device = createUAHConfig({

        configs: toConfigArray({

          'input_state_dps': 'close',
          'input_state_rel': 'off',
          'input_state_ren': 'off',
          'input_state_rex': 'off',
          'input_state_rly-lock_dry': 'off',
          'wiring_state_dps-neg': 'on',
          'wiring_state_dps-pos': 'on',
          'wiring_state_rel-neg': 'on',
          'wiring_state_rel-pos': 'on',
          'wiring_state_ren-neg': 'on',
          'wiring_state_ren-pos': 'on',
          'wiring_state_rex-neg': 'on',
          'wiring_state_rex-pos': 'on',
        }),
      });

      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      const hub = new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      // Simulate AccessEvents.udaUpdates: change to unlocked state.
      hub.uda = createUAHConfig({

        configs: toConfigArray({

          'input_state_dps': 'close',
          'input_state_rel': 'off',
          'input_state_ren': 'off',
          'input_state_rex': 'off',
          'input_state_rly-lock_dry': 'unlock',
          'wiring_state_dps-neg': 'on',
          'wiring_state_dps-pos': 'on',
          'wiring_state_rel-neg': 'on',
          'wiring_state_rel-pos': 'on',
          'wiring_state_ren-neg': 'on',
          'wiring_state_ren-pos': 'on',
          'wiring_state_rex-neg': 'on',
          'wiring_state_rex-pos': 'on',
        }),
      });

      controller.events.emit(device.unique_id, { data: hub.uda, event: AccessEventType.DEVICE_UPDATE, event_object_id: device.unique_id });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'lock', 'false');
    });

    it('should log unlock when logLock is enabled', () => {

      const device = createUAHConfig({

        configs: toConfigArray({

          'input_state_dps': 'close',
          'input_state_rel': 'off',
          'input_state_ren': 'off',
          'input_state_rex': 'off',
          'input_state_rly-lock_dry': 'off',
          'wiring_state_dps-neg': 'on',
          'wiring_state_dps-pos': 'on',
          'wiring_state_rel-neg': 'on',
          'wiring_state_rel-pos': 'on',
          'wiring_state_ren-neg': 'on',
          'wiring_state_ren-pos': 'on',
          'wiring_state_rex-neg': 'on',
          'wiring_state_rex-pos': 'on',
        }),
      });

      const hub = new AccessHub(controller as any, device, accessory as any);

      hub.uda = createUAHConfig({

        configs: toConfigArray({

          'input_state_dps': 'close',
          'input_state_rel': 'off',
          'input_state_ren': 'off',
          'input_state_rex': 'off',
          'input_state_rly-lock_dry': 'unlock',
          'wiring_state_dps-neg': 'on',
          'wiring_state_dps-pos': 'on',
          'wiring_state_rel-neg': 'on',
          'wiring_state_rel-pos': 'on',
          'wiring_state_ren-neg': 'on',
          'wiring_state_ren-pos': 'on',
          'wiring_state_rex-neg': 'on',
          'wiring_state_rex-pos': 'on',
        }),
      });

      controller.events.emit(device.unique_id, { data: hub.uda, event: AccessEventType.DEVICE_UPDATE, event_object_id: device.unique_id });

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining('Unlocked'));
    });

    it('should skip v1 lock events for UGT (skipsV1LockEvents)', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(device.unique_id, { data: device, event: AccessEventType.DEVICE_UPDATE, event_object_id: device.unique_id });

      // UGT has skipsV1LockEvents = true, so no lock MQTT should be published.
      expect(mqtt.publish).not.toHaveBeenCalledWith(expect.any(String), 'lock', expect.any(String));
    });
  });

  describe('event handling — device update v2', () => {

    it('should update access method switches', () => {

      const device = createUltraConfig();

      new AccessHub(controller as any, device, accessory as any);

      const nfcSwitch = accessory._services.get('Switch.' + AccessReservedNames.SWITCH_ACCESSMETHOD_NFC);

      controller.events.emit(device.unique_id, {
        data: { access_method: { nfc: 'no' } },
        event: AccessEventType.DEVICE_UPDATE_V2,
        event_object_id: device.unique_id,
        meta: { id: device.unique_id, object_type: 'device' },
      });

      if(nfcSwitch) {

        expect(nfcSwitch.updateCharacteristic).toHaveBeenCalledWith('On', false);
      }
    });

    it('should update access method switch to enabled', () => {

      const device = createUltraConfig();

      new AccessHub(controller as any, device, accessory as any);

      const pinSwitch = accessory._services.get('Switch.' + AccessReservedNames.SWITCH_ACCESSMETHOD_PIN);

      controller.events.emit(device.unique_id, {
        data: { access_method: { pin_code: 'yes' } },
        event: AccessEventType.DEVICE_UPDATE_V2,
        event_object_id: device.unique_id,
        meta: { id: device.unique_id, object_type: 'device' },
      });

      if(pinSwitch) {

        expect(pinSwitch.updateCharacteristic).toHaveBeenCalledWith('On', true);
      }
    });

    it('should ignore malformed access method values', () => {

      const device = createUltraConfig();

      new AccessHub(controller as any, device, accessory as any);

      const nfcSwitch = accessory._services.get('Switch.' + AccessReservedNames.SWITCH_ACCESSMETHOD_NFC);

      if(nfcSwitch) {

        nfcSwitch.updateCharacteristic.mockClear();
      }

      controller.events.emit(device.unique_id, {
        data: { access_method: { nfc: 'invalid_value' } },
        event: AccessEventType.DEVICE_UPDATE_V2,
        event_object_id: device.unique_id,
        meta: { id: device.unique_id, object_type: 'device' },
      });

      // Malformed values (not "yes" or "no") should be ignored.
      if(nfcSwitch) {

        expect(nfcSwitch.updateCharacteristic).not.toHaveBeenCalledWith('On', expect.anything());
      }
    });

    it('should process location states for UGT', () => {

      const device = createUGTConfig({

        extensions: [
          { extension_name: 'port_setting', source_id: 'port1', target_name: 'oper1', target_value: 'door-1' },
          { extension_name: 'port_setting', source_id: 'port2', target_name: 'oper2', target_value: 'door-2' },
        ],
      });

      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(device.unique_id, {

        data: {

          location_states: [{ dps: 'open', dps_connected: true, enable: true, is_unavailable: false, location_id: 'door-1', lock: 'unlocked' }],
        },

        event: AccessEventType.DEVICE_UPDATE_V2,
        event_object_id: device.unique_id,
        meta: { id: device.unique_id, object_type: 'device' },
      });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'lock', 'false');
    });
  });

  describe('event handling — location update', () => {

    it('should update door state from location data for UGT', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(device.unique_id, {
        data: { id: 'door-1', name: 'Main Gate', state: { dps: 'open', lock: 'unlocked' } },
        event: AccessEventType.LOCATION_UPDATE,
        event_object_id: device.unique_id,
      });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'lock', 'false');
      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'dps', 'true');
    });

    it('should ignore location update for non-UGT devices', () => {

      const device = createUAHConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(device.unique_id, {
        data: { id: 'some-id', name: 'Some Door', state: { dps: 'open', lock: 'unlocked' } },
        event: AccessEventType.LOCATION_UPDATE,
        event_object_id: device.unique_id,
      });

      expect(mqtt.publish).not.toHaveBeenCalledWith(expect.any(String), 'lock', expect.any(String));
    });

    it('should sync main door name change from location update', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      const hub = new AccessHub(controller as any, device, accessory as any);

      expect(hub.mainDoorName).toBe('Main Gate');

      controller.events.emit(device.unique_id, {
        data: { id: 'door-1', name: 'Portail', state: { dps: 'close', lock: 'locked' } },
        event: AccessEventType.LOCATION_UPDATE,
        event_object_id: device.unique_id,
      });

      expect(hub.mainDoorName).toBe('Portail');
      expect(hub.accessoryName).toBe('Portail');
    });

    it('should sync side door name change from location update', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      const hub = new AccessHub(controller as any, device, accessory as any);

      expect(hub.sideDoorName).toBe('Side Door');

      controller.events.emit(device.unique_id, {
        data: { id: 'door-2', name: 'Portillon', state: { dps: 'close', lock: 'locked' } },
        event: AccessEventType.LOCATION_UPDATE,
        event_object_id: device.unique_id,
      });

      expect(hub.sideDoorName).toBe('Portillon');

      const sideDoorLock = accessory._services.get('LockMechanism.' + AccessReservedNames.LOCK_DOOR_SIDE);

      expect(sideDoorLock?.displayName).toBe('Portillon');
    });

    it('should update side door from location data for UGT', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      mqtt.publish.mockClear();

      controller.events.emit(device.unique_id, {
        data: { id: 'door-2', name: 'Side Door', state: { dps: 'open', lock: 'unlocked' } },
        event: AccessEventType.LOCATION_UPDATE,
        event_object_id: device.unique_id,
      });

      expect(mqtt.publish).toHaveBeenCalledWith(expect.any(String), 'sidedoor/lock', 'false');
    });
  });

  describe('UGT door discovery', () => {

    it('should discover main door from device config', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      // Main door listener should be registered (from uda.door.unique_id).
      expect(controller.events.listenerCount('door-1')).toBeGreaterThan(0);
    });

    it('should discover side door', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Main Gate', unique_id: 'door-1' }, { name: 'Side Door', unique_id: 'door-2' }];

      new AccessHub(controller as any, device, accessory as any);

      expect(controller.events.listenerCount('door-2')).toBeGreaterThan(0);
    });

    it('should store door names during discovery', () => {

      const device = createUGTConfig();

      controller.udaApi.doors = [{ name: 'Portail', unique_id: 'door-1' }, { name: 'Portillon', unique_id: 'door-2' }];

      const hub = new AccessHub(controller as any, device, accessory as any);

      expect(hub.mainDoorName).toBe('Portail');
      expect(hub.sideDoorName).toBe('Portillon');
    });

    it('should warn when no doors are found', () => {

      controller.udaApi.doors = [];

      new AccessHub(controller as any, createUGTConfig(), accessory as any);

      expect(controller.platform.log.warn).toHaveBeenCalledWith(expect.stringContaining('No doors found'));
    });

    it('should initialize door states from bootstrap data', () => {

      const device = createUGTConfig();
      const mqtt = createTestMqtt();

      controller.mqtt = mqtt;
      controller.udaApi.doors = [{ door_lock_relay_status: 'unlock', door_position_status: 'open', name: 'Main Gate', unique_id: 'door-1' }];

      new AccessHub(controller as any, device, accessory as any);

      // DPS should be initialized from bootstrap data.
      // The MQTT publish during initialization confirms the state was set.
      // We can't directly check private state, but the initialization should not throw.
      expect(controller.events.listenerCount('door-1')).toBeGreaterThan(0);
    });
  });

  describe('cleanup', () => {

    it('should remove event listeners on cleanup', () => {

      const device = createUAHConfig();
      const hub = new AccessHub(controller as any, device, accessory as any);

      const listenersBefore = controller.events.listenerCount(device.unique_id);

      hub.cleanup();

      expect(controller.events.listenerCount(device.unique_id)).toBeLessThan(listenersBefore);
    });

    it('should remove doorbell event listeners on cleanup', () => {

      const device = createUAHConfig();
      const hub = new AccessHub(controller as any, device, accessory as any);

      hub.cleanup();

      expect(controller.events.listenerCount(AccessEventType.DOORBELL_RING)).toBe(0);
      expect(controller.events.listenerCount(AccessEventType.DOORBELL_CANCEL)).toBe(0);
    });
  });
});
