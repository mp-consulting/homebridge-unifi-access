/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * lib-featureoptions.test.ts: Tests for the feature options engine.
 */
import { describe, expect, it } from 'vitest';
import { FeatureOptions } from '../src/lib/featureoptions.js';

const CATEGORIES = [

  { description: 'Device feature options.', name: 'Device' },
  { description: 'Hub feature options.', name: 'Hub' },
];

const OPTIONS = {

  'Device': [
    { default: true, description: 'Make this device available in HomeKit.', name: '' },
    { default: false, description: 'Sync names.', name: 'SyncName' },
  ],

  'Hub': [
    { default: true, description: 'Door position sensor.', name: 'DPS' },
    { default: false, defaultValue: 5, description: 'Lock delay, in minutes.', name: 'LockDelayInterval' },
    { default: true, defaultValue: 2.5, description: 'Gate duration, in seconds.', name: 'GateDuration' },
  ],
};

const DEVICE = 'AABBCCDDEEFF';
const CONTROLLER = '001122334455';

function create(configured: string[] = []): FeatureOptions {

  return new FeatureOptions(CATEGORIES, OPTIONS, configured);
}

describe('FeatureOptions', () => {

  describe('test', () => {

    it('falls back to the registered default, or false for unknown options', () => {

      const options = create();

      expect(options.test('Device')).toBe(true);
      expect(options.test('Device.SyncName')).toBe(false);
      expect(options.test('Not.An.Option')).toBe(false);
    });

    it('resolves device scope over controller scope over global scope', () => {

      const options = create([ 'Disable.Hub.DPS', 'Enable.Hub.DPS.' + CONTROLLER, 'Disable.Hub.DPS.' + DEVICE ]);

      expect(options.test('Hub.DPS')).toBe(false);
      expect(options.test('Hub.DPS', 'OTHERDEVICE', CONTROLLER)).toBe(true);
      expect(options.test('Hub.DPS', DEVICE, CONTROLLER)).toBe(false);
      expect(options.scope('Hub.DPS', DEVICE, CONTROLLER)).toBe('device');
      expect(options.scope('Hub.DPS', 'OTHERDEVICE', CONTROLLER)).toBe('controller');
      expect(options.scope('Hub.DPS', 'OTHERDEVICE', 'OTHERCONTROLLER')).toBe('global');
      expect(options.scope('Device.SyncName', DEVICE, CONTROLLER)).toBe('none');
    });

    it('matches options and identifiers case-insensitively', () => {

      const options = create([ 'disable.hub.dps.aabbccddeeff' ]);

      expect(options.test('Hub.DPS', DEVICE)).toBe(false);
      expect(options.test('HUB.DPS', DEVICE.toLowerCase())).toBe(false);
    });

    it('lets the first of conflicting entries win', () => {

      expect(create([ 'Enable.Device.SyncName', 'Disable.Device.SyncName' ]).test('Device.SyncName')).toBe(true);
    });

    it('ignores malformed entries', () => {

      const options = create([ 'Toggle.Device.SyncName', 'garbage', '' ]);

      expect(options.test('Device.SyncName')).toBe(false);
      expect(options.configuredOptions).toEqual([ 'Toggle.Device.SyncName', 'garbage', '' ]);
    });
  });

  describe('value', () => {

    it('returns null for options that are not value-centric', () => {

      expect(create([ 'Enable.Hub.DPS' ]).value('Hub.DPS')).toBeNull();
    });

    it('returns the registered default when an enabled-by-default option is not configured', () => {

      expect(create().value('Hub.GateDuration')).toBe('2.5');
      expect(create().getFloat('Hub.GateDuration')).toBe(2.5);
    });

    it('returns null when the option is disabled or off by default', () => {

      expect(create().value('Hub.LockDelayInterval')).toBeNull();
      expect(create().getInteger('Hub.LockDelayInterval')).toBeNull();
      expect(create([ 'Disable.Hub.GateDuration' ]).value('Hub.GateDuration')).toBeNull();
    });

    it('extracts global and device-scoped values, preserving their case', () => {

      const options = create([ 'Enable.Hub.LockDelayInterval.' + DEVICE + '.10', 'Enable.Hub.LockDelayInterval.3', 'Enable.Hub.GateDuration.' + DEVICE + '.Fast' ]);

      expect(options.getInteger('Hub.LockDelayInterval', DEVICE, CONTROLLER)).toBe(10);
      expect(options.getInteger('Hub.LockDelayInterval', 'OTHERDEVICE', CONTROLLER)).toBe(3);
      expect(options.value('Hub.GateDuration', DEVICE)).toBe('Fast');
    });

    it('returns undefined for an option enabled at an explicit scope without a value', () => {

      expect(create([ 'Enable.Hub.LockDelayInterval' ]).value('Hub.LockDelayInterval')).toBeUndefined();
      expect(create([ 'Enable.Hub.LockDelayInterval' ]).getInteger('Hub.LockDelayInterval')).toBeUndefined();
    });

    it('treats a lone trailing segment as a global value by default', () => {

      const options = create([ 'Enable.Hub.LockDelayInterval.' + DEVICE ]);

      expect(options.value('Hub.LockDelayInterval', 'OTHERDEVICE')).toBe(DEVICE);
    });

    it('treats a lone trailing identifier as a device scope when it can recognize identifiers', () => {

      const options = new FeatureOptions(CATEGORIES, OPTIONS, [ 'Enable.Hub.LockDelayInterval.' + DEVICE, 'Enable.Hub.GateDuration.4' ],
        { isIdentifier: segment => /^[0-9a-f]{12}$/i.test(segment) });

      // The device itself has the option enabled, with no value of its own.
      expect(options.test('Hub.LockDelayInterval', DEVICE)).toBe(true);
      expect(options.value('Hub.LockDelayInterval', DEVICE)).toBeUndefined();

      // Every other device is unaffected.
      expect(options.test('Hub.LockDelayInterval', 'OTHERDEVICE')).toBe(false);
      expect(options.value('Hub.LockDelayInterval', 'OTHERDEVICE')).toBeNull();

      // Genuine global values still work.
      expect(options.getFloat('Hub.GateDuration', DEVICE)).toBe(4);
    });

    it('returns undefined for values that are not numbers', () => {

      expect(create([ 'Enable.Hub.LockDelayInterval.soon' ]).getInteger('Hub.LockDelayInterval')).toBeUndefined();
      expect(create([ 'Enable.Hub.GateDuration.fast' ]).getFloat('Hub.GateDuration')).toBeUndefined();
    });
  });

  describe('scope helpers', () => {

    it('reports where an option has been configured', () => {

      const options = create([ 'Enable.Device.SyncName', 'Disable.Hub.DPS.' + DEVICE ]);

      expect(options.isScopeGlobal('Device.SyncName')).toBe(true);
      expect(options.isScopeGlobal('Hub.DPS')).toBe(false);
      expect(options.isScopeDevice('Hub.DPS', DEVICE)).toBe(true);
      expect(options.exists('Hub.DPS', 'OTHERDEVICE')).toBe(false);
    });

    it('maps scopes to webUI colors', () => {

      const options = create([ 'Enable.Device.SyncName', 'Enable.Hub.DPS.' + CONTROLLER, 'Disable.Hub.DPS.' + DEVICE ]);

      expect(options.color('Hub.DPS', DEVICE, CONTROLLER)).toBe('text-info');
      expect(options.color('Hub.DPS', 'OTHERDEVICE', CONTROLLER)).toBe('text-success');
      expect(options.color('Device.SyncName', DEVICE)).toBe('text-warning');
      expect(options.color('Device.SyncName')).toBe('text-info');
      expect(options.color('Hub.LockDelayInterval')).toBe('');
    });
  });

  describe('metadata', () => {

    it('expands category and option names', () => {

      const options = create();

      expect(options.expandOption('Hub', 'DPS')).toBe('Hub.DPS');
      expect(options.expandOption(CATEGORIES[0], OPTIONS.Device[0])).toBe('Device');
      expect(options.expandOption('', 'DPS')).toBe('');
    });

    it('identifies value-centric options', () => {

      const options = create();

      expect(options.isValue('Hub.LockDelayInterval')).toBe(true);
      expect(options.isValue('hub.gateduration')).toBe(true);
      expect(options.isValue('Hub.DPS')).toBe(false);
      expect(options.isValue('')).toBe(false);
    });

    it('re-indexes when the configured options change', () => {

      const options = create();

      options.configuredOptions = [ 'Enable.Device.SyncName' ];

      expect(options.test('Device.SyncName')).toBe(true);
    });
  });
});
