import { describe, expect, it } from 'vitest';
import {
  deviceCatalog, getDeviceCatalog, getSensorConfig,
  modelsDps, modelsRel, modelsRen, modelsRex, modelsSideDoor, modelsDefaultGarageDoor, modelsDefaultLock,
} from '../src/access-device-catalog.js';
import type { DeviceCatalogEntry, SensorInput } from '../src/access-device-catalog.js';

// All device type keys present in the catalog.
const ALL_DEVICE_TYPES = ['UAH', 'UA-Hub-Door-Mini', 'UA-ULTRA', 'UGT', 'UAH-Ent', 'UVC G6 Entry'];

// Every field that must exist on a DeviceCatalogEntry.
const REQUIRED_FIELDS: (keyof DeviceCatalogEntry)[] = [
  'appendsSourceId', 'defaultDoorService', 'displayModel',
  'hasDps', 'hasRel', 'hasRen', 'hasRex',
  'lockRelayConfigKey', 'sensors',
  'skipsV1LockEvents', 'supportsSideDoor',
  'usesConfigsApi', 'usesLocationApi', 'usesProxyMode',
];

describe('Device catalog entries', () => {

  it('should contain exactly 6 devices', () => {

    expect(Object.keys(deviceCatalog)).toHaveLength(6);
  });

  it('should contain all expected device types', () => {

    for(const deviceType of ALL_DEVICE_TYPES) {

      expect(deviceCatalog).toHaveProperty(deviceType);
    }
  });

  describe.each(ALL_DEVICE_TYPES)('%s has all required DeviceCatalogEntry fields', (deviceType) => {

    const entry = deviceCatalog[deviceType];

    it.each(REQUIRED_FIELDS)('has field: %s', (field) => {

      expect(entry).toHaveProperty(field);
    });
  });

  describe('UAH (UA Hub)', () => {

    const entry = deviceCatalog.UAH;

    it('should have correct display model', () => {

      expect(entry.displayModel).toBe('UA Hub');
    });

    it('should default to Lock door service', () => {

      expect(entry.defaultDoorService).toBe('Lock');
    });

    it('should not append source id', () => {

      expect(entry.appendsSourceId).toBe(false);
    });

    it('should support all four sensor types', () => {

      expect(entry.hasDps).toBe(true);
      expect(entry.hasRel).toBe(true);
      expect(entry.hasRen).toBe(true);
      expect(entry.hasRex).toBe(true);
    });

    it('should have the correct lock relay config key', () => {

      expect(entry.lockRelayConfigKey).toBe('input_state_rly-lock_dry');
    });

    it('should not skip v1 lock events', () => {

      expect(entry.skipsV1LockEvents).toBe(false);
    });

    it('should not support side door', () => {

      expect(entry.supportsSideDoor).toBe(false);
    });

    it('should not use configs API', () => {

      expect(entry.usesConfigsApi).toBe(false);
    });

    it('should not use location API', () => {

      expect(entry.usesLocationApi).toBe(false);
    });

    it('should not use proxy mode', () => {

      expect(entry.usesProxyMode).toBe(false);
    });

    it('should not have sideDoor config', () => {

      expect(entry.sideDoor).toBeUndefined();
    });
  });

  describe('UA-Hub-Door-Mini (UA Hub Door Mini)', () => {

    const entry = deviceCatalog['UA-Hub-Door-Mini'];

    it('should have correct display model', () => {

      expect(entry.displayModel).toBe('UA Hub Door Mini');
    });

    it('should default to Lock door service', () => {

      expect(entry.defaultDoorService).toBe('Lock');
    });

    it('should not append source id', () => {

      expect(entry.appendsSourceId).toBe(false);
    });

    it('should support Dps and Rex but not Rel and Ren', () => {

      expect(entry.hasDps).toBe(true);
      expect(entry.hasRel).toBe(false);
      expect(entry.hasRen).toBe(false);
      expect(entry.hasRex).toBe(true);
    });

    it('should have the correct lock relay config key', () => {

      expect(entry.lockRelayConfigKey).toBe('output_d1_lock_relay');
    });

    it('should not skip v1 lock events', () => {

      expect(entry.skipsV1LockEvents).toBe(false);
    });

    it('should not use proxy mode', () => {

      expect(entry.usesProxyMode).toBe(false);
    });

    it('should not have sideDoor config', () => {

      expect(entry.sideDoor).toBeUndefined();
    });
  });

  describe('UA-ULTRA (UA Ultra)', () => {

    const entry = deviceCatalog['UA-ULTRA'];

    it('should have correct display model', () => {

      expect(entry.displayModel).toBe('UA Ultra');
    });

    it('should default to Lock door service', () => {

      expect(entry.defaultDoorService).toBe('Lock');
    });

    it('should not append source id', () => {

      expect(entry.appendsSourceId).toBe(false);
    });

    it('should support Dps and Rex but not Rel and Ren', () => {

      expect(entry.hasDps).toBe(true);
      expect(entry.hasRel).toBe(false);
      expect(entry.hasRen).toBe(false);
      expect(entry.hasRex).toBe(true);
    });

    it('should have the correct lock relay config key', () => {

      expect(entry.lockRelayConfigKey).toBe('output_d1_lock_relay');
    });

    it('should use proxy mode', () => {

      expect(entry.usesProxyMode).toBe(true);
    });

    it('should not skip v1 lock events', () => {

      expect(entry.skipsV1LockEvents).toBe(false);
    });

    it('should not have sideDoor config', () => {

      expect(entry.sideDoor).toBeUndefined();
    });
  });

  describe('UGT (UA Gate)', () => {

    const entry = deviceCatalog.UGT;

    it('should have correct display model', () => {

      expect(entry.displayModel).toBe('UA Gate');
    });

    it('should default to GarageDoorOpener door service', () => {

      expect(entry.defaultDoorService).toBe('GarageDoorOpener');
    });

    it('should not append source id', () => {

      expect(entry.appendsSourceId).toBe(false);
    });

    it('should support only Dps', () => {

      expect(entry.hasDps).toBe(true);
      expect(entry.hasRel).toBe(false);
      expect(entry.hasRen).toBe(false);
      expect(entry.hasRex).toBe(false);
    });

    it('should have the correct lock relay config key', () => {

      expect(entry.lockRelayConfigKey).toBe('output_oper1_relay');
    });

    it('should skip v1 lock events', () => {

      expect(entry.skipsV1LockEvents).toBe(true);
    });

    it('should support side door', () => {

      expect(entry.supportsSideDoor).toBe(true);
    });

    it('should use location API', () => {

      expect(entry.usesLocationApi).toBe(true);
    });

    it('should not use proxy mode', () => {

      expect(entry.usesProxyMode).toBe(false);
    });
  });

  describe('UAH-Ent (UA Hub Enterprise)', () => {

    const entry = deviceCatalog['UAH-Ent'];

    it('should have correct display model', () => {

      expect(entry.displayModel).toBe('UA Hub Enterprise');
    });

    it('should default to Lock door service', () => {

      expect(entry.defaultDoorService).toBe('Lock');
    });

    it('should append source id', () => {

      expect(entry.appendsSourceId).toBe(true);
    });

    it('should support all four sensor types', () => {

      expect(entry.hasDps).toBe(true);
      expect(entry.hasRel).toBe(true);
      expect(entry.hasRen).toBe(true);
      expect(entry.hasRex).toBe(true);
    });

    it('should have the correct lock relay config key', () => {

      expect(entry.lockRelayConfigKey).toBe('input_state_rly-lock_dry');
    });

    it('should not skip v1 lock events', () => {

      expect(entry.skipsV1LockEvents).toBe(false);
    });

    it('should not support side door', () => {

      expect(entry.supportsSideDoor).toBe(false);
    });

    it('should not use proxy mode', () => {

      expect(entry.usesProxyMode).toBe(false);
    });

    it('should not have sideDoor config', () => {

      expect(entry.sideDoor).toBeUndefined();
    });
  });

  describe('UVC G6 Entry', () => {

    const entry = deviceCatalog['UVC G6 Entry'];

    it('should have correct display model', () => {

      expect(entry.displayModel).toBe('UVC G6 Entry');
    });

    it('should default to Lock door service', () => {

      expect(entry.defaultDoorService).toBe('Lock');
    });

    it('should not append source id', () => {

      expect(entry.appendsSourceId).toBe(false);
    });

    it('should not support any sensor type', () => {

      expect(entry.hasDps).toBe(false);
      expect(entry.hasRel).toBe(false);
      expect(entry.hasRen).toBe(false);
      expect(entry.hasRex).toBe(false);
    });

    it('should have the correct lock relay config key', () => {

      expect(entry.lockRelayConfigKey).toBe('input_state_rly-lock_dry');
    });

    it('should use configs API', () => {

      expect(entry.usesConfigsApi).toBe(true);
    });

    it('should have an empty sensors object', () => {

      expect(entry.sensors).toEqual({});
    });

    it('should not skip v1 lock events', () => {

      expect(entry.skipsV1LockEvents).toBe(false);
    });

    it('should not use proxy mode', () => {

      expect(entry.usesProxyMode).toBe(false);
    });

    it('should not have sideDoor config', () => {

      expect(entry.sideDoor).toBeUndefined();
    });
  });
});

describe('getDeviceCatalog()', () => {

  it.each(ALL_DEVICE_TYPES)('should return the correct entry for known device type: %s', (deviceType) => {

    const entry = getDeviceCatalog(deviceType);

    expect(entry).toBeDefined();
    expect(entry).toBe(deviceCatalog[deviceType]);
  });

  it('should return undefined for an unknown device type', () => {

    expect(getDeviceCatalog('UNKNOWN-DEVICE')).toBeUndefined();
  });

  it('should return undefined for an empty string', () => {

    expect(getDeviceCatalog('')).toBeUndefined();
  });

  it('should be case-sensitive', () => {

    expect(getDeviceCatalog('uah')).toBeUndefined();
    expect(getDeviceCatalog('Uah')).toBeUndefined();
    expect(getDeviceCatalog('UAH')).toBeDefined();
  });
});

describe('getSensorConfig()', () => {

  describe('valid device and sensor combinations', () => {

    it('should return Dps config for UAH', () => {

      const config = getSensorConfig('UAH', 'Dps');

      expect(config).toBeDefined();
      expect(config!.configKey).toBe('input_state_dps');
      expect(config!.wiringKeys).toEqual(['wiring_state_dps-neg', 'wiring_state_dps-pos']);
      expect(config!.proxyMode).toBeUndefined();
    });

    it('should return Rel config for UAH', () => {

      const config = getSensorConfig('UAH', 'Rel');

      expect(config).toBeDefined();
      expect(config!.configKey).toBe('input_state_rel');
      expect(config!.wiringKeys).toEqual(['wiring_state_rel-neg', 'wiring_state_rel-pos']);
    });

    it('should return Ren config for UAH', () => {

      const config = getSensorConfig('UAH', 'Ren');

      expect(config).toBeDefined();
      expect(config!.configKey).toBe('input_state_ren');
      expect(config!.wiringKeys).toEqual(['wiring_state_ren-neg', 'wiring_state_ren-pos']);
    });

    it('should return Rex config for UAH', () => {

      const config = getSensorConfig('UAH', 'Rex');

      expect(config).toBeDefined();
      expect(config!.configKey).toBe('input_state_rex');
      expect(config!.wiringKeys).toEqual(['wiring_state_rex-neg', 'wiring_state_rex-pos']);
    });

    it('should return Dps config for UA-Hub-Door-Mini', () => {

      const config = getSensorConfig('UA-Hub-Door-Mini', 'Dps');

      expect(config).toBeDefined();
      expect(config!.configKey).toBe('input_d1_dps');
      expect(config!.wiringKeys).toEqual(['wiring_state_d1-dps-neg', 'wiring_state_d1-dps-pos']);
      expect(config!.proxyMode).toBeUndefined();
    });

    it('should return Rex config for UA-Hub-Door-Mini', () => {

      const config = getSensorConfig('UA-Hub-Door-Mini', 'Rex');

      expect(config).toBeDefined();
      expect(config!.configKey).toBe('input_d1_button');
      expect(config!.wiringKeys).toEqual(['wiring_state_d1-button-neg', 'wiring_state_d1-button-pos']);
      expect(config!.proxyMode).toBeUndefined();
    });

    it('should return Dps config for UGT', () => {

      const config = getSensorConfig('UGT', 'Dps');

      expect(config).toBeDefined();
      expect(config!.configKey).toBe('input_gate_dps');
      expect(config!.wiringKeys).toEqual(['wiring_state_gate-dps-neg', 'wiring_state_gate-dps-pos']);
    });

    it('should return all four sensor configs for UAH-Ent', () => {

      const dps = getSensorConfig('UAH-Ent', 'Dps');
      const rel = getSensorConfig('UAH-Ent', 'Rel');
      const ren = getSensorConfig('UAH-Ent', 'Ren');
      const rex = getSensorConfig('UAH-Ent', 'Rex');

      expect(dps).toBeDefined();
      expect(rel).toBeDefined();
      expect(ren).toBeDefined();
      expect(rex).toBeDefined();

      expect(dps!.configKey).toBe('input_state_dps');
      expect(rel!.configKey).toBe('input_state_rel');
      expect(ren!.configKey).toBe('input_state_ren');
      expect(rex!.configKey).toBe('input_state_rex');
    });
  });

  describe('sensors not supported by a device', () => {

    it('should return undefined for Rel on UA-Hub-Door-Mini', () => {

      expect(getSensorConfig('UA-Hub-Door-Mini', 'Rel')).toBeUndefined();
    });

    it('should return undefined for Ren on UA-Hub-Door-Mini', () => {

      expect(getSensorConfig('UA-Hub-Door-Mini', 'Ren')).toBeUndefined();
    });

    it('should return undefined for Rel on UA-ULTRA', () => {

      expect(getSensorConfig('UA-ULTRA', 'Rel')).toBeUndefined();
    });

    it('should return undefined for Ren on UA-ULTRA', () => {

      expect(getSensorConfig('UA-ULTRA', 'Ren')).toBeUndefined();
    });

    it('should return undefined for Rex on UGT', () => {

      expect(getSensorConfig('UGT', 'Rex')).toBeUndefined();
    });

    it('should return undefined for Rel on UGT', () => {

      expect(getSensorConfig('UGT', 'Rel')).toBeUndefined();
    });

    it('should return undefined for Ren on UGT', () => {

      expect(getSensorConfig('UGT', 'Ren')).toBeUndefined();
    });

    it('should return undefined for all sensors on UVC G6 Entry', () => {

      const sensorTypes: SensorInput[] = ['Dps', 'Rel', 'Ren', 'Rex'];

      for(const sensor of sensorTypes) {

        expect(getSensorConfig('UVC G6 Entry', sensor)).toBeUndefined();
      }
    });
  });

  describe('unknown device types', () => {

    it('should return undefined for an unknown device type', () => {

      expect(getSensorConfig('NONEXISTENT', 'Dps')).toBeUndefined();
    });
  });
});

describe('Derived model arrays', () => {

  describe('modelsDps', () => {

    it('should include exactly the 5 devices with hasDps: true', () => {

      expect(modelsDps).toHaveLength(5);
      expect(modelsDps).toContain('UA Hub');
      expect(modelsDps).toContain('UA Hub Door Mini');
      expect(modelsDps).toContain('UA Ultra');
      expect(modelsDps).toContain('UA Gate');
      expect(modelsDps).toContain('UA Hub Enterprise');
    });

    it('should not include UVC G6 Entry', () => {

      expect(modelsDps).not.toContain('UVC G6 Entry');
    });
  });

  describe('modelsRel', () => {

    it('should include exactly UAH and UAH-Ent', () => {

      expect(modelsRel).toHaveLength(2);
      expect(modelsRel).toContain('UA Hub');
      expect(modelsRel).toContain('UA Hub Enterprise');
    });

    it('should not include devices without Rel support', () => {

      expect(modelsRel).not.toContain('UA Hub Door Mini');
      expect(modelsRel).not.toContain('UA Ultra');
      expect(modelsRel).not.toContain('UA Gate');
      expect(modelsRel).not.toContain('UVC G6 Entry');
    });
  });

  describe('modelsRen', () => {

    it('should include exactly UAH and UAH-Ent', () => {

      expect(modelsRen).toHaveLength(2);
      expect(modelsRen).toContain('UA Hub');
      expect(modelsRen).toContain('UA Hub Enterprise');
    });

    it('should not include devices without Ren support', () => {

      expect(modelsRen).not.toContain('UA Hub Door Mini');
      expect(modelsRen).not.toContain('UA Ultra');
      expect(modelsRen).not.toContain('UA Gate');
      expect(modelsRen).not.toContain('UVC G6 Entry');
    });
  });

  describe('modelsRex', () => {

    it('should include exactly UAH, UA-Hub-Door-Mini, UA-ULTRA, and UAH-Ent', () => {

      expect(modelsRex).toHaveLength(4);
      expect(modelsRex).toContain('UA Hub');
      expect(modelsRex).toContain('UA Hub Door Mini');
      expect(modelsRex).toContain('UA Ultra');
      expect(modelsRex).toContain('UA Hub Enterprise');
    });

    it('should not include UGT or UVC G6 Entry', () => {

      expect(modelsRex).not.toContain('UA Gate');
      expect(modelsRex).not.toContain('UVC G6 Entry');
    });
  });

  describe('modelsSideDoor', () => {

    it('should include only UA Gate', () => {

      expect(modelsSideDoor).toHaveLength(1);
      expect(modelsSideDoor).toContain('UA Gate');
    });
  });

  describe('modelsDefaultGarageDoor', () => {

    it('should include only UA Gate', () => {

      expect(modelsDefaultGarageDoor).toHaveLength(1);
      expect(modelsDefaultGarageDoor).toContain('UA Gate');
    });
  });

  describe('modelsDefaultLock', () => {

    it('should include devices with Lock default that do not append source id and do not use configs API', () => {

      expect(modelsDefaultLock).toContain('UA Hub');
      expect(modelsDefaultLock).toContain('UA Hub Door Mini');
      expect(modelsDefaultLock).toContain('UA Ultra');
    });

    it('should exclude UAH-Ent because it appends source id', () => {

      expect(modelsDefaultLock).not.toContain('UA Hub Enterprise');
    });

    it('should exclude UVC G6 Entry because it uses configs API', () => {

      expect(modelsDefaultLock).not.toContain('UVC G6 Entry');
    });

    it('should exclude UA Gate because its default door service is GarageDoorOpener', () => {

      expect(modelsDefaultLock).not.toContain('UA Gate');
    });

    it('should contain exactly 3 models', () => {

      expect(modelsDefaultLock).toHaveLength(3);
    });
  });
});

describe('Side door config', () => {

  it('should be defined on UGT with correct keys', () => {

    const entry = deviceCatalog.UGT;

    expect(entry.sideDoor).toBeDefined();
    expect(entry.sideDoor!.dpsConfigKey).toBe('input_door_dps');
    expect(entry.sideDoor!.lockRelayConfigKey).toBe('output_oper2_relay');
    expect(entry.sideDoor!.dpsWiringKeys).toEqual(['wiring_state_door-dps-neg', 'wiring_state_door-dps-pos']);
  });

  it('should have exactly three properties on the sideDoor object', () => {

    const entry = deviceCatalog.UGT;

    expect(Object.keys(entry.sideDoor!)).toHaveLength(3);
    expect(Object.keys(entry.sideDoor!)).toEqual(expect.arrayContaining(['dpsConfigKey', 'dpsWiringKeys', 'lockRelayConfigKey']));
  });

  it('should not be defined on any device other than UGT', () => {

    const nonGateDevices = ALL_DEVICE_TYPES.filter(dt => dt !== 'UGT');

    for(const deviceType of nonGateDevices) {

      expect(deviceCatalog[deviceType].sideDoor).toBeUndefined();
    }
  });
});

describe('UA-ULTRA proxy mode', () => {

  const entry = deviceCatalog['UA-ULTRA'];

  it('should have usesProxyMode set to true', () => {

    expect(entry.usesProxyMode).toBe(true);
  });

  it("should define Dps sensor with proxyMode 'dps' and no wiringKeys", () => {

    const dps = entry.sensors.Dps;

    expect(dps).toBeDefined();
    expect(dps!.proxyMode).toBe('dps');
    expect(dps!.configKey).toBe('input_d1_dps');
    expect(dps!.wiringKeys).toBeUndefined();
  });

  it("should define Rex sensor with proxyMode 'rex' and no wiringKeys", () => {

    const rex = entry.sensors.Rex;

    expect(rex).toBeDefined();
    expect(rex!.proxyMode).toBe('rex');
    expect(rex!.configKey).toBe('input_d1_button');
    expect(rex!.wiringKeys).toBeUndefined();
  });

  it('should be the only device using proxy mode', () => {

    for(const deviceType of ALL_DEVICE_TYPES.filter(dt => dt !== 'UA-ULTRA')) {

      expect(deviceCatalog[deviceType].usesProxyMode).toBe(false);
    }
  });

  it('should have sensors that use proxyMode instead of wiringKeys, in contrast with wiring-based devices', () => {

    // UA-ULTRA Dps uses proxyMode, UA-Hub-Door-Mini Dps uses wiringKeys -- verify the contrast.
    const ultraDps = getSensorConfig('UA-ULTRA', 'Dps')!;
    const miniDps = getSensorConfig('UA-Hub-Door-Mini', 'Dps')!;

    expect(ultraDps.proxyMode).toBeDefined();
    expect(ultraDps.wiringKeys).toBeUndefined();

    expect(miniDps.proxyMode).toBeUndefined();
    expect(miniDps.wiringKeys).toBeDefined();
    expect(miniDps.wiringKeys).toHaveLength(2);
  });
});
