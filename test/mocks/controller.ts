/* Mock AccessController for testing. */
import { vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createMockAPI, createMockAccessory, createMockHAP } from './homebridge.js';
import { createMockAccessApi, createMockControllerConfig } from './unifi-access.js';

// Create a mock log object that captures messages.
export function createMockLog() {

  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

// Create a mock platform.
export function createMockPlatform() {

  const api = createMockAPI();
  const log = createMockLog();

  return {

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
}

// The feature options that move services onto their own HomeKit accessory.
export const SEPARATE_ACCESSORY_OPTIONS = [ 'AccessMethod.SeparateAccessory', 'Hub.Doorbell.SeparateAccessory', 'Hub.Sensors.SeparateAccessory' ];

// Create a mock AccessController.
export function createMockController(overrides: Record<string, unknown> = {}) {

  const platform = createMockPlatform();
  const udaApi = createMockAccessApi();
  const events = new EventEmitter() as EventEmitter & { removeListener: ReturnType<typeof vi.fn> };

  events.removeListener = vi.fn(EventEmitter.prototype.removeListener.bind(events));
  const log = createMockLog();
  const hap = createMockHAP();

  // Child accessories handed out by acquireChildAccessory, keyed by subtype.
  const childAccessories = new Map<string, ReturnType<typeof createMockAccessory>>();

  const controller = {

    // Sensors that have been split onto their own HomeKit tile. Functional so that tests can exercise the separate accessory path.
    acquireChildAccessory: vi.fn((device: { accessory: { UUID: string } }, subtype: string, name: string) => {

      let child = childAccessories.get(subtype);

      if(!child) {

        child = createMockAccessory(device.accessory.UUID + '.' + subtype);
        child.displayName = name;
        childAccessories.set(subtype, child);
        platform.accessories.push(child);
      }

      return child;
    }),

    api: platform.api,
    childAccessories,
    config: { address: '192.168.1.1', mqttTopic: 'unifi/access', password: 'test', username: 'admin' },
    configuredDevices: {} as Record<string, unknown>,
    events,
    hap,

    // Every feature option is on by default, apart from the separate accessory options - those rearrange where services live, so leaving them off keeps the
    // mock on the plugin's default accessory layout. Tests that want a separate layout override hasFeature.
    hasFeature: vi.fn((option: string, _device?: unknown) => !SEPARATE_ACCESSORY_OPTIONS.includes(option)),

    id: 'controller-test-id',
    log,
    logApiErrors: true,
    mqtt: null as { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; subscribeGet: ReturnType<typeof vi.fn>;
      subscribeSet: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> } | null,

    platform,

    releaseChildAccessory: vi.fn((_device: unknown, subtype: string) => {

      const child = childAccessories.get(subtype);

      if(child) {

        platform.accessories.splice(platform.accessories.indexOf(child), 1);
        childAccessories.delete(subtype);
      }
    }),

    removeHomeKitDevice: vi.fn(),
    deviceLookup: vi.fn(),

    uda: createMockControllerConfig(),
    udaApi,

    ...overrides,
  };

  return controller;
}

// Create a mock MQTT client.
export function createMockMqtt() {

  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    subscribeGet: vi.fn(),
    subscribeSet: vi.fn(),
    unsubscribe: vi.fn(),
  };
}
