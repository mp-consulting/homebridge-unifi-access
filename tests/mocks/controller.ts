/* Mock AccessController for testing. */
import { vi } from "vitest";
import { EventEmitter } from "node:events";
import { createMockAPI, createMockHAP } from "./homebridge.js";
import { createMockAccessApi, createMockControllerConfig } from "./unifi-access.js";

// Create a mock log object that captures messages.
export function createMockLog() {

  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
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
      value: vi.fn().mockReturnValue(null)
    },

    log
  };
}

// Create a mock AccessController.
export function createMockController(overrides: Record<string, unknown> = {}) {

  const platform = createMockPlatform();
  const udaApi = createMockAccessApi();
  const events = new EventEmitter() as EventEmitter & { removeListener: ReturnType<typeof vi.fn> };

  events.removeListener = vi.fn(EventEmitter.prototype.removeListener.bind(events));
  const log = createMockLog();
  const hap = createMockHAP();

  // Default feature options — all enabled.
  const enabledFeatures = new Set<string>();

  const controller = {

    api: platform.api,
    config: { address: "192.168.1.1", mqttTopic: "unifi/access", password: "test", username: "admin" },
    configuredDevices: {} as Record<string, unknown>,
    events,
    hap,

    hasFeature: vi.fn((_option: string, _device?: unknown) => true),

    id: "controller-test-id",
    log,
    logApiErrors: true,
    mqtt: null as { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; subscribeGet: ReturnType<typeof vi.fn>;
      subscribeSet: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> } | null,

    platform,

    removeHomeKitDevice: vi.fn(),
    deviceLookup: vi.fn(),

    uda: createMockControllerConfig(),
    udaApi,

    ...overrides
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
    unsubscribe: vi.fn()
  };
}
