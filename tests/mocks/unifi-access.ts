/* Mock UniFi Access API objects for testing. */
import { vi } from 'vitest';
import type { AccessDeviceConfig, AccessEventPacket } from 'unifi-access';
import type { AccessEventType } from '../../src/access-types.js';

// Create a mock device config for a specific device type.
export function createMockDeviceConfig(overrides: Partial<AccessDeviceConfig> = {}): AccessDeviceConfig {

  return {

    adopt_time: 0,
    adopted_by_uid: 'test-uid',
    alias: 'Test Device',
    capabilities: ['is_hub'],
    connected_uah_id: '',
    configs: [] as { key: string; value: string }[],
    device_type: 'UAH',
    display_model: 'UA Hub',
    door: { unique_id: 'door-1' },
    extensions: [],
    firmware: 'v3.0.0',
    firmware_update: null,
    guid: 'test-guid',
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
    model: 'UAH',
    name: 'Test Hub',
    need_advisory: false,
    resource_name: 'test',
    revision_update_time: 0,
    security_check: false,
    source_id: '1',
    start_time: 0,
    type: 'UAH',
    unique_id: 'test-device-unique-id',
    version: '3.0.0',
    wiring_state: {},
    ...overrides,
  } as AccessDeviceConfig;
}

// Create a mock UAH (UA Hub) device.
export function createMockUAH(overrides: Partial<AccessDeviceConfig> = {}): AccessDeviceConfig {

  return createMockDeviceConfig({

    capabilities: ['is_hub', 'door_bell', 'nfc_card_easy_provision', 'pin_code'],
    configs: [
      { key: 'input_state_dps', value: 'close' },
      { key: 'input_state_rel', value: 'off' },
      { key: 'input_state_ren', value: 'off' },
      { key: 'input_state_rex', value: 'off' },
      { key: 'input_state_rly-lock_dry', value: 'lock' },
      { key: 'wiring_state_dps-neg', value: 'on' },
      { key: 'wiring_state_dps-pos', value: 'on' },
      { key: 'wiring_state_rel-neg', value: 'on' },
      { key: 'wiring_state_rel-pos', value: 'on' },
      { key: 'wiring_state_ren-neg', value: 'on' },
      { key: 'wiring_state_ren-pos', value: 'on' },
      { key: 'wiring_state_rex-neg', value: 'on' },
      { key: 'wiring_state_rex-pos', value: 'on' },
    ],
    device_type: 'UAH',
    display_model: 'UA Hub',
    ...overrides,
  });
}

// Create a mock UGT (UA Gate) device.
export function createMockUGT(overrides: Partial<AccessDeviceConfig> = {}): AccessDeviceConfig {

  return createMockDeviceConfig({

    capabilities: ['is_hub', 'door_bell'],
    configs: [
      { key: 'input_door_dps', value: 'close' },
      { key: 'input_gate_dps', value: 'close' },
      { key: 'output_oper1_relay', value: 'lock' },
      { key: 'output_oper2_relay', value: 'lock' },
      { key: 'wiring_state_door-dps-neg', value: 'on' },
      { key: 'wiring_state_door-dps-pos', value: 'on' },
      { key: 'wiring_state_gate-dps-neg', value: 'on' },
      { key: 'wiring_state_gate-dps-pos', value: 'on' },
    ],
    device_type: 'UGT',
    display_model: 'UA Gate',
    ...overrides,
  });
}

// Create a mock UA-ULTRA device.
export function createMockUltra(overrides: Partial<AccessDeviceConfig> = {}): AccessDeviceConfig {

  return createMockDeviceConfig({

    capabilities: ['is_hub', 'is_reader', 'identity_face_unlock', 'hand_wave', 'mobile_unlock_ver2', 'support_mobile_unlock',
      'nfc_card_easy_provision', 'pin_code', 'qr_code', 'support_apple_pass'],
    configs: [
      { key: 'input_d1_button', value: 'off' },
      { key: 'input_d1_dps', value: 'close' },
      { key: 'output_d1_lock_relay', value: 'lock' },
    ],
    device_type: 'UA-ULTRA',
    display_model: 'UA Ultra',
    extensions: [{ extension_name: 'rex_button_mode', target_name: '', target_value: 'rex' }],
    ...overrides,
  });
}

// Create a mock UAH-Ent (UA Hub Enterprise) device.
export function createMockEnterprise(overrides: Partial<AccessDeviceConfig> = {}): AccessDeviceConfig {

  return createMockDeviceConfig({

    capabilities: ['is_hub'],
    configs: [
      { key: 'input_state_dps', value: 'close' },
      { key: 'input_state_rel', value: 'off' },
      { key: 'input_state_ren', value: 'off' },
      { key: 'input_state_rex', value: 'off' },
      { key: 'input_state_rly-lock_dry', value: 'lock' },
      { key: 'wiring_state_dps-neg', value: 'on' },
      { key: 'wiring_state_dps-pos', value: 'on' },
      { key: 'wiring_state_rel-neg', value: 'on' },
      { key: 'wiring_state_rel-pos', value: 'on' },
      { key: 'wiring_state_ren-neg', value: 'on' },
      { key: 'wiring_state_ren-pos', value: 'on' },
      { key: 'wiring_state_rex-neg', value: 'on' },
      { key: 'wiring_state_rex-pos', value: 'on' },
    ],
    device_type: 'UAH-Ent',
    display_model: 'UA Hub Enterprise',
    source_id: '1',
    ...overrides,
  });
}

// Create a mock event packet.
export function createMockEventPacket(event: AccessEventType | string, deviceId: string, data: unknown = {}): AccessEventPacket {

  return {

    data,
    event,
    event_object_id: deviceId,
    meta: { id: deviceId, object_type: 'device' },
  } as AccessEventPacket;
}

// Create a mock AccessApi.
export function createMockAccessApi() {

  return {

    controller: {
      host: { firmware_version: '4.0.0', mac: '00:11:22:33:44:55' },
      version: '2.0.0',
    },

    devices: [] as AccessDeviceConfig[],
    doors: [] as { name: string; unique_id: string }[],

    getApiEndpoint: vi.fn().mockReturnValue('/api/v1'),
    getBootstrap: vi.fn().mockResolvedValue(undefined),
    getDeviceName: vi.fn((device: AccessDeviceConfig) => device.alias ?? device.name),
    getFullName: vi.fn((device: AccessDeviceConfig) => device.alias ?? device.name),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    name: 'Test Controller',
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    reset: vi.fn(),
    responseOk: vi.fn().mockReturnValue(true),
    retrieve: vi.fn().mockResolvedValue({ statusCode: 200 }),
    unlock: vi.fn().mockResolvedValue(undefined),
  };
}

// Create a mock controller config.
export function createMockControllerConfig() {

  return {

    host: {
      firmware_version: '4.0.0',
      mac: '00:11:22:33:44:55',
    },
    version: '2.0.0',
  };
}
