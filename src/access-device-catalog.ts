/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-device-catalog.ts: Device catalog for UniFi Access - single source of truth for all device-specific knowledge.
 */

// The sensor inputs supported across Access devices.
export type SensorInput = 'Dps' | 'Rel' | 'Ren' | 'Rex';

// Valid proxy modes for devices that use extension-based input detection (e.g. UA-ULTRA).
type ProxyMode = 'dps' | 'rex';

// Terminal input configuration for a specific sensor on a specific device type.
export interface SensorConfig {

  // The config key used to read the sensor's current state from uda.configs.
  configKey?: string;

  // For devices that use proxy mode (e.g. UA-ULTRA), this specifies the rex_button_mode value that enables this sensor. When set, wiringKeys are
  // ignored and the extension config is checked instead.
  proxyMode?: ProxyMode;

  // Wiring keys that must all be "on" to consider this sensor as physically wired.
  wiringKeys?: string[];
}

// Complete configuration for the side door (gate pedestrian door), only applicable to UGT.
interface SideDoorConfig {

  dpsConfigKey: string;
  dpsWiringKeys: string[];
  lockRelayConfigKey: string;
}

// A single entry in the device catalog, representing all known device-specific behavior.
export interface DeviceCatalogEntry {

  // When true, source_id is appended to the MAC address to form the device's unique identifier (for multi-door devices like UAH-Ent).
  appendsSourceId: boolean;

  // The default HomeKit door service type for this device.
  defaultDoorService: 'Lock' | 'GarageDoorOpener';

  // The user-facing display model name (e.g. "UA Hub", "UA Gate").
  displayModel: string;

  // Capability flags used to derive feature option model arrays.
  hasDps: boolean;
  hasRel: boolean;
  hasRen: boolean;
  hasRex: boolean;

  // Config key for reading the lock relay state from uda.configs.
  lockRelayConfigKey: string;

  // Per-sensor terminal input configuration.
  sensors: Partial<Record<SensorInput, SensorConfig>>;

  // Side door configuration (UGT only). Undefined for devices without a side door.
  sideDoor?: SideDoorConfig;

  // When true, the device's v1 API lock/DPS events are not sent by the controller and should be skipped in the event handler.
  skipsV1LockEvents: boolean;

  // When true, the device can have a side door (pedestrian gate).
  supportsSideDoor: boolean;

  // When true, the device uses /configs?is_camera=true endpoint instead of /settings for access method changes.
  usesConfigsApi: boolean;

  // When true, the device uses the location-based unlock API endpoint instead of the standard device unlock API.
  usesLocationApi: boolean;

  // When true, the device uses proxy mode (rex_button_mode extension) instead of wiring keys for determining terminal input availability.
  usesProxyMode: boolean;
}

// UGT port and extension identifiers used when mapping physical doors to location IDs.
export const UGT_MAIN_PORT_SOURCE_ID = 'port1';
export const UGT_SIDE_PORT_SOURCE_ID = 'port2';
export const UGT_SIDE_DOOR_TARGET_NAME = 'oper2';

// The device catalog, keyed by device_type. This is the single source of truth for all device-specific knowledge in the plugin.
export const deviceCatalog: Readonly<Record<string, DeviceCatalogEntry>> = {

  'UA-Hub-Door-Mini': {

    appendsSourceId: false,
    defaultDoorService: 'Lock',
    displayModel: 'UA Hub Door Mini',
    hasDps: true,
    hasRel: false,
    hasRen: false,
    hasRex: true,
    lockRelayConfigKey: 'output_d1_lock_relay',

    sensors: {

      Dps: { configKey: 'input_d1_dps', wiringKeys: [ 'wiring_state_d1-dps-neg', 'wiring_state_d1-dps-pos' ] },
      Rex: { configKey: 'input_d1_button', wiringKeys: [ 'wiring_state_d1-button-neg', 'wiring_state_d1-button-pos' ] },
    },

    skipsV1LockEvents: false,
    supportsSideDoor: false,
    usesConfigsApi: false,
    usesLocationApi: false,
    usesProxyMode: false,
  },

  'UA-ULTRA': {

    appendsSourceId: false,
    defaultDoorService: 'Lock',
    displayModel: 'UA Ultra',
    hasDps: true,
    hasRel: false,
    hasRen: false,
    hasRex: true,
    lockRelayConfigKey: 'output_d1_lock_relay',

    sensors: {

      Dps: { configKey: 'input_d1_dps', proxyMode: 'dps' },
      Rex: { configKey: 'input_d1_button', proxyMode: 'rex' },
    },

    skipsV1LockEvents: false,
    supportsSideDoor: false,
    usesConfigsApi: false,
    usesLocationApi: false,
    usesProxyMode: true,
  },

  'UAH': {

    appendsSourceId: false,
    defaultDoorService: 'Lock',
    displayModel: 'UA Hub',
    hasDps: true,
    hasRel: true,
    hasRen: true,
    hasRex: true,
    lockRelayConfigKey: 'input_state_rly-lock_dry',

    sensors: {

      Dps: { configKey: 'input_state_dps', wiringKeys: [ 'wiring_state_dps-neg', 'wiring_state_dps-pos' ] },
      Rel: { configKey: 'input_state_rel', wiringKeys: [ 'wiring_state_rel-neg', 'wiring_state_rel-pos' ] },
      Ren: { configKey: 'input_state_ren', wiringKeys: [ 'wiring_state_ren-neg', 'wiring_state_ren-pos' ] },
      Rex: { configKey: 'input_state_rex', wiringKeys: [ 'wiring_state_rex-neg', 'wiring_state_rex-pos' ] },
    },

    skipsV1LockEvents: false,
    supportsSideDoor: false,
    usesConfigsApi: false,
    usesLocationApi: false,
    usesProxyMode: false,
  },

  'UAH-Ent': {

    appendsSourceId: true,
    defaultDoorService: 'Lock',
    displayModel: 'UA Hub Enterprise',
    hasDps: true,
    hasRel: true,
    hasRen: true,
    hasRex: true,
    lockRelayConfigKey: 'input_state_rly-lock_dry',

    sensors: {

      Dps: { configKey: 'input_state_dps', wiringKeys: [ 'wiring_state_dps-neg', 'wiring_state_dps-pos' ] },
      Rel: { configKey: 'input_state_rel', wiringKeys: [ 'wiring_state_rel-neg', 'wiring_state_rel-pos' ] },
      Ren: { configKey: 'input_state_ren', wiringKeys: [ 'wiring_state_ren-neg', 'wiring_state_ren-pos' ] },
      Rex: { configKey: 'input_state_rex', wiringKeys: [ 'wiring_state_rex-neg', 'wiring_state_rex-pos' ] },
    },

    skipsV1LockEvents: false,
    supportsSideDoor: false,
    usesConfigsApi: false,
    usesLocationApi: false,
    usesProxyMode: false,
  },

  'UGT': {

    appendsSourceId: false,
    defaultDoorService: 'GarageDoorOpener',
    displayModel: 'UA Gate',
    hasDps: true,
    hasRel: false,
    hasRen: false,
    hasRex: false,
    lockRelayConfigKey: 'output_oper1_relay',

    sensors: {

      Dps: { configKey: 'input_gate_dps', wiringKeys: [ 'wiring_state_gate-dps-neg', 'wiring_state_gate-dps-pos' ] },
    },

    sideDoor: {

      dpsConfigKey: 'input_door_dps',
      dpsWiringKeys: [ 'wiring_state_door-dps-neg', 'wiring_state_door-dps-pos' ],
      lockRelayConfigKey: 'output_oper2_relay',
    },

    skipsV1LockEvents: true,
    supportsSideDoor: true,
    usesConfigsApi: false,
    usesLocationApi: true,
    usesProxyMode: false,
  },

  'UVC G6 Entry': {

    appendsSourceId: false,
    defaultDoorService: 'Lock',
    displayModel: 'UVC G6 Entry',
    hasDps: false,
    hasRel: false,
    hasRen: false,
    hasRex: false,
    lockRelayConfigKey: 'input_state_rly-lock_dry',
    sensors: {},
    skipsV1LockEvents: false,
    supportsSideDoor: false,
    usesConfigsApi: true,
    usesLocationApi: false,
    usesProxyMode: false,
  },
};

// Look up a device catalog entry by device_type. Returns undefined for unknown devices.
export function getDeviceCatalog(deviceType: string): DeviceCatalogEntry | undefined {

  return deviceCatalog[deviceType];
}

// Look up sensor configuration for a specific device and sensor input.
export function getSensorConfig(deviceType: string, sensor: SensorInput): SensorConfig | undefined {

  return getDeviceCatalog(deviceType)?.sensors[sensor];
}

// Returns an array of display_model strings for devices that match a given predicate.
function modelsWithCapability(predicate: (entry: DeviceCatalogEntry) => boolean): string[] {

  return Object.values(deviceCatalog).filter(predicate).map(entry => entry.displayModel);
}

// Pre-computed model arrays, replacing the hardcoded arrays in access-options.ts.
export const modelsDps = modelsWithCapability(e => e.hasDps);
export const modelsRel = modelsWithCapability(e => e.hasRel);
export const modelsRen = modelsWithCapability(e => e.hasRen);
export const modelsRex = modelsWithCapability(e => e.hasRex);
export const modelsSideDoor = modelsWithCapability(e => e.supportsSideDoor);
export const modelsDefaultGarageDoor = modelsWithCapability(e => e.defaultDoorService === 'GarageDoorOpener');
export const modelsDefaultLock = modelsWithCapability(e => (e.defaultDoorService === 'Lock') && !e.appendsSourceId && !e.usesConfigsApi);
