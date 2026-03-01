import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessEvents } from "../src/access-events.js";
import { AccessEventType, AccessReservedNames } from "../src/access-types.js";
import { createMockController, createMockMqtt } from "./mocks/controller.js";
import { createMockAccessory, createMockService, MockCharacteristic, MockService } from "./mocks/homebridge.js";
import { createMockDeviceConfig, createMockEventPacket } from "./mocks/unifi-access.js";

describe("AccessEvents", () => {

  let controller: ReturnType<typeof createMockController>;
  let events: AccessEvents;
  let messageHandler: ((packet: any) => void) | undefined;

  beforeEach(() => {

    controller = createMockController();

    // The constructor calls configureEvents(), which calls udaApi.on("message", handler).
    events = new AccessEvents(controller as any);

    // Capture the message handler that was registered with udaApi.on.
    const messageCall = controller.udaApi.on.mock.calls.find((c: any[]) => c[0] === "message");

    messageHandler = messageCall?.[1];
  });

  afterEach(() => {

    events.removeAllListeners();
  });

  describe("Constructor", () => {

    it("should register a message handler on the udaApi", () => {

      expect(controller.udaApi.on).toHaveBeenCalledWith("message", expect.any(Function));
    });

    it("should have captured the message handler", () => {

      expect(messageHandler).toBeDefined();
      expect(typeof messageHandler).toBe("function");
    });

    it("should register a DEVICE_UPDATE listener via prependListener", () => {

      // The events instance should have a listener for DEVICE_UPDATE.
      expect(events.listenerCount(AccessEventType.DEVICE_UPDATE)).toBeGreaterThanOrEqual(1);
    });

    it("should register a DEVICE_DELETE listener via prependListener", () => {

      expect(events.listenerCount(AccessEventType.DEVICE_DELETE)).toBeGreaterThanOrEqual(1);
    });

    it("should log telemetry message when telemetry is enabled", () => {

      const telemetryController = createMockController({ hasFeature: vi.fn(() => true) });

      new AccessEvents(telemetryController as any);

      expect(telemetryController.log.info).toHaveBeenCalledWith("Access controller telemetry enabled.");
    });
  });

  describe("Event routing", () => {

    it("should emit an event for the packet event type", () => {

      const handler = vi.fn();

      events.on(AccessEventType.DOORBELL_RING, handler);

      const packet = createMockEventPacket(AccessEventType.DOORBELL_RING, "device-1");

      messageHandler!(packet);

      expect(handler).toHaveBeenCalledWith(packet);
    });

    it("should emit an event for the event_object_id", () => {

      const handler = vi.fn();

      events.on("device-1", handler);

      const packet = createMockEventPacket(AccessEventType.DOORBELL_RING, "device-1");

      messageHandler!(packet);

      expect(handler).toHaveBeenCalledWith(packet);
    });

    it("should emit a combined event+device_id event", () => {

      const handler = vi.fn();

      events.on(AccessEventType.DOORBELL_RING + ".device-1", handler);

      const packet = createMockEventPacket(AccessEventType.DOORBELL_RING, "device-1");

      messageHandler!(packet);

      expect(handler).toHaveBeenCalledWith(packet);
    });

    it("should emit meta.id for V2 device update events with object_type 'device'", () => {

      const handler = vi.fn();

      events.on("meta-device-id", handler);

      const packet = {
        data: {},
        event: AccessEventType.DEVICE_UPDATE_V2,
        event_object_id: "some-object",
        meta: { id: "meta-device-id", object_type: "device" }
      };

      messageHandler!(packet);

      expect(handler).toHaveBeenCalledWith(packet);
    });

    it("should not emit meta.id for V2 events with non-device object_type", () => {

      const handler = vi.fn();

      events.on("meta-location-id", handler);

      const packet = {
        data: {},
        event: AccessEventType.DEVICE_UPDATE_V2,
        event_object_id: "some-object",
        meta: { id: "meta-location-id", object_type: "location" }
      };

      messageHandler!(packet);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not emit meta.id for non-V2 events", () => {

      const handler = vi.fn();

      events.on("device-1", handler);

      const packet = createMockEventPacket(AccessEventType.DEVICE_UPDATE, "device-1");

      messageHandler!(packet);

      // The handler should be called once for the event_object_id, but not a second time for meta.id.
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should publish telemetry to MQTT when enabled and mqtt is configured", () => {

      const mqtt = createMockMqtt();

      const telemetryController = createMockController({ hasFeature: vi.fn(() => true), mqtt });

      const telemetryEvents = new AccessEvents(telemetryController as any);

      const telemetryMessageHandler = telemetryController.udaApi.on.mock.calls.find((c: any[]) => c[0] === "message")?.[1];

      const packet = createMockEventPacket(AccessEventType.DOORBELL_RING, "device-1");

      telemetryMessageHandler!(packet);

      // Telemetry should be sanitized — only safe fields published.
      const published = mqtt.publish.mock.calls.find((c: any[]) => c[1] === "telemetry");

      expect(published).toBeDefined();

      const parsed = JSON.parse(published![2]);

      expect(parsed.event).toBe(AccessEventType.DOORBELL_RING);
      expect(parsed.event_object_id).toBe("device-1");
      expect(parsed.data).toBeUndefined();

      telemetryEvents.removeAllListeners();
    });

    it("should include meta.id and meta.object_type in sanitized telemetry when meta is present", () => {

      const mqtt = createMockMqtt();

      const telemetryController = createMockController({ hasFeature: vi.fn(() => true), mqtt });

      const telemetryEvents = new AccessEvents(telemetryController as any);

      const telemetryMessageHandler = telemetryController.udaApi.on.mock.calls.find((c: any[]) => c[0] === "message")?.[1];

      const packet = {
        data: { sensitive: "should-not-appear" },
        event: AccessEventType.DEVICE_UPDATE_V2,
        event_object_id: "obj-1",
        meta: { id: "meta-id-1", object_type: "device", some_other_field: "secret" }
      };

      telemetryMessageHandler!(packet);

      const published = mqtt.publish.mock.calls.find((c: any[]) => c[1] === "telemetry");
      const parsed = JSON.parse(published![2]);

      expect(parsed.meta).toEqual({ id: "meta-id-1", object_type: "device" });
      expect(parsed.meta.some_other_field).toBeUndefined();
      expect(parsed.data).toBeUndefined();

      telemetryEvents.removeAllListeners();
    });

    it("should not include meta in sanitized telemetry when meta is absent", () => {

      const mqtt = createMockMqtt();

      const telemetryController = createMockController({ hasFeature: vi.fn(() => true), mqtt });

      const telemetryEvents = new AccessEvents(telemetryController as any);

      const telemetryMessageHandler = telemetryController.udaApi.on.mock.calls.find((c: any[]) => c[0] === "message")?.[1];

      // Create a packet without meta.
      const packet = { data: {}, event: AccessEventType.DOORBELL_RING, event_object_id: "device-1" };

      telemetryMessageHandler!(packet);

      const published = mqtt.publish.mock.calls.find((c: any[]) => c[1] === "telemetry");
      const parsed = JSON.parse(published![2]);

      expect(parsed.meta).toBeUndefined();

      telemetryEvents.removeAllListeners();
    });
  });

  describe("udaUpdates (DEVICE_UPDATE handling)", () => {

    it("should update device uda when device is found", () => {

      const mockAccessory = createMockAccessory("acc-uuid");

      mockAccessory.services = [];

      const mockDevice = {
        accessory: mockAccessory,
        accessoryName: "Test Device",
        hints: { syncName: false },
        isOnline: true,
        log: { info: vi.fn() },
        uda: createMockDeviceConfig()
      };

      controller.deviceLookup.mockReturnValue(mockDevice);

      const updatedConfig = createMockDeviceConfig({ alias: "Updated Device", is_online: false });
      const packet = createMockEventPacket(AccessEventType.DEVICE_UPDATE, "test-device-unique-id", updatedConfig);

      messageHandler!(packet);

      expect(mockDevice.uda).toBe(updatedConfig);
    });

    it("should update StatusActive on services that have it", () => {

      const service = createMockService(MockService.MotionSensor);

      service.testCharacteristic.mockReturnValue(true);

      const mockAccessory = createMockAccessory("acc-uuid");

      mockAccessory.services = [service];

      const mockDevice = {
        accessory: mockAccessory,
        accessoryName: "Test Device",
        hints: { syncName: false },
        isOnline: true,
        log: { info: vi.fn() },
        uda: createMockDeviceConfig()
      };

      controller.deviceLookup.mockReturnValue(mockDevice);

      const updatedConfig = createMockDeviceConfig();
      const packet = createMockEventPacket(AccessEventType.DEVICE_UPDATE, "test-device-unique-id", updatedConfig);

      messageHandler!(packet);

      expect(service.testCharacteristic).toHaveBeenCalledWith(MockCharacteristic.StatusActive);
      expect(service.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.StatusActive, true);
    });

    it("should handle device not found gracefully", () => {

      controller.deviceLookup.mockReturnValue(null);

      const packet = createMockEventPacket(AccessEventType.DEVICE_UPDATE, "nonexistent-device", createMockDeviceConfig());

      // Should not throw.
      expect(() => messageHandler!(packet)).not.toThrow();
    });

    it("should sync name when syncName is enabled and alias has changed", () => {

      const mockAccessory = createMockAccessory("acc-uuid");

      mockAccessory.services = [];

      const mockDevice = {
        accessory: mockAccessory,
        accessoryName: "Old Name",
        configureInfo: vi.fn(),
        hints: { syncName: true },
        isOnline: true,
        log: { info: vi.fn() },
        get resolvedName() { return this.uda.alias; },
        uda: createMockDeviceConfig({ alias: "Old Name" })
      };

      controller.deviceLookup.mockReturnValue(mockDevice);

      const updatedConfig = createMockDeviceConfig({ alias: "New Name" });
      const packet = createMockEventPacket(AccessEventType.DEVICE_UPDATE, "test-device-unique-id", updatedConfig);

      messageHandler!(packet);

      expect(mockDevice.log.info).toHaveBeenCalledWith(expect.stringContaining("Name change detected"));
      expect(mockDevice.configureInfo).toHaveBeenCalled();
    });
  });

  describe("manageDevices (DEVICE_DELETE handling)", () => {

    it("should call removeHomeKitDevice when a known device is deleted", () => {

      const mockAccessory = createMockAccessory("acc-uuid");

      const mockDevice = { accessory: mockAccessory, uda: createMockDeviceConfig() };

      controller.deviceLookup.mockReturnValue(mockDevice);

      const packet = createMockEventPacket(AccessEventType.DEVICE_DELETE, "test-device-unique-id");

      messageHandler!(packet);

      expect(controller.removeHomeKitDevice).toHaveBeenCalledWith(mockAccessory);
    });

    it("should not call removeHomeKitDevice when the device is not found", () => {

      controller.deviceLookup.mockReturnValue(null);

      const packet = createMockEventPacket(AccessEventType.DEVICE_DELETE, "nonexistent-device");

      messageHandler!(packet);

      expect(controller.removeHomeKitDevice).not.toHaveBeenCalled();
    });
  });

  describe("motionEventHandler", () => {

    it("should trigger motion delivery when MotionSensor service exists", () => {

      const motionService = createMockService(MockService.MotionSensor);

      const mockAccessory = createMockAccessory("acc-uuid");

      mockAccessory.getService.mockImplementation((type: string) => type === MockService.MotionSensor ? motionService : undefined);

      const mockDevice = {
        accessory: mockAccessory,
        hints: { logMotion: false, motionDuration: 10 },
        id: "test-device-id",
        log: { debug: vi.fn(), info: vi.fn() }
      };

      events.motionEventHandler(mockDevice as any);

      expect(motionService.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.MotionDetected, true);
    });

    it("should not trigger motion delivery when MotionSensor service does not exist", () => {

      const mockAccessory = createMockAccessory("acc-uuid");

      mockAccessory.getService.mockReturnValue(undefined);

      const mockDevice = {
        accessory: mockAccessory,
        hints: { logMotion: false, motionDuration: 10 },
        id: "test-device-id",
        log: { debug: vi.fn(), info: vi.fn() }
      };

      // Should not throw.
      expect(() => events.motionEventHandler(mockDevice as any)).not.toThrow();
    });
  });

  describe("Motion event lifecycle", () => {

    let mockDevice: any;
    let motionService: ReturnType<typeof createMockService>;

    beforeEach(() => {

      vi.useFakeTimers();

      motionService = createMockService(MockService.MotionSensor);

      const mockAccessory = createMockAccessory("acc-uuid");

      mockAccessory.getService.mockImplementation((type: string) => type === MockService.MotionSensor ? motionService : undefined);
      mockAccessory.getServiceById.mockReturnValue(undefined);
      mockAccessory.context = {};

      mockDevice = {
        accessory: mockAccessory,
        hints: { logMotion: false, motionDuration: 10 },
        id: "test-device-id",
        log: { debug: vi.fn(), info: vi.fn() }
      };
    });

    afterEach(() => {

      vi.useRealTimers();
    });

    it("should set MotionDetected to true when motion is triggered", () => {

      events.motionEventHandler(mockDevice);

      expect(motionService.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.MotionDetected, true);
    });

    it("should publish motion true to MQTT when mqtt is configured", () => {

      const mqtt = createMockMqtt();

      controller.mqtt = mqtt;

      // Recreate events with the mqtt-enabled controller.
      events.removeAllListeners();
      events = new AccessEvents(controller as any);

      events.motionEventHandler(mockDevice);

      expect(mqtt.publish).toHaveBeenCalledWith("test-device-id", "motion", "true");
    });

    it("should log motion when logMotion hint is enabled", () => {

      mockDevice.hints.logMotion = true;

      events.motionEventHandler(mockDevice);

      expect(mockDevice.log.info).toHaveBeenCalledWith("Motion detected.");
    });

    it("should not log motion when logMotion hint is disabled", () => {

      mockDevice.hints.logMotion = false;

      events.motionEventHandler(mockDevice);

      expect(mockDevice.log.info).not.toHaveBeenCalled();
    });

    it("should reset MotionDetected to false after motionDuration expires", () => {

      events.motionEventHandler(mockDevice);

      // MotionDetected should be true initially.
      expect(motionService.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.MotionDetected, true);

      // Advance time by motionDuration seconds (10 * 1000).
      vi.advanceTimersByTime(10 * 1000);

      expect(motionService.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.MotionDetected, false);
    });

    it("should publish motion false to MQTT after motionDuration expires", () => {

      const mqtt = createMockMqtt();

      controller.mqtt = mqtt;
      events.removeAllListeners();
      events = new AccessEvents(controller as any);

      events.motionEventHandler(mockDevice);

      vi.advanceTimersByTime(10 * 1000);

      expect(mqtt.publish).toHaveBeenCalledWith("test-device-id", "motion", "false");
    });

    it("should not trigger a second motion event while one is already inflight", () => {

      events.motionEventHandler(mockDevice);

      // Reset mock call counts.
      motionService.updateCharacteristic.mockClear();

      // Try to trigger another motion event.
      events.motionEventHandler(mockDevice);

      // MotionDetected should not be set again.
      expect(motionService.updateCharacteristic).not.toHaveBeenCalledWith(MockCharacteristic.MotionDetected, true);
    });

    it("should log a debug message when a motion event is rate-limited", () => {

      events.motionEventHandler(mockDevice);

      mockDevice.log.debug.mockClear();

      // Trigger again while the first is still inflight.
      events.motionEventHandler(mockDevice);

      expect(mockDevice.log.debug).toHaveBeenCalledWith("Motion event rate-limited: event already in progress.");
    });

    it("should allow a new motion event after the previous one has expired", () => {

      events.motionEventHandler(mockDevice);

      // Advance past the motion duration.
      vi.advanceTimersByTime(10 * 1000);

      motionService.updateCharacteristic.mockClear();

      // Trigger a new motion event.
      events.motionEventHandler(mockDevice);

      expect(motionService.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.MotionDetected, true);
    });

    it("should skip motion delivery when detectMotion is false in context", () => {

      mockDevice.accessory.context.detectMotion = false;

      events.motionEventHandler(mockDevice);

      expect(motionService.updateCharacteristic).not.toHaveBeenCalledWith(MockCharacteristic.MotionDetected, true);
    });

    it("should deliver motion when detectMotion is true in context", () => {

      mockDevice.accessory.context.detectMotion = true;

      events.motionEventHandler(mockDevice);

      expect(motionService.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.MotionDetected, true);
    });

    it("should update the motion trigger switch if present", () => {

      const triggerSwitch = createMockService(MockService.Switch, AccessReservedNames.SWITCH_MOTION_TRIGGER);

      mockDevice.accessory.getServiceById.mockImplementation((type: string, subtype: string) =>
        type === MockService.Switch && subtype === AccessReservedNames.SWITCH_MOTION_TRIGGER ? triggerSwitch : undefined);

      events.motionEventHandler(mockDevice);

      expect(triggerSwitch.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.On, true);

      // After the timer expires, it should be set to false.
      vi.advanceTimersByTime(10 * 1000);

      expect(triggerSwitch.updateCharacteristic).toHaveBeenCalledWith(MockCharacteristic.On, false);
    });
  });
});
