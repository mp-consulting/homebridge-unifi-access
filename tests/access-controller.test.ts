import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessController } from "../src/access-controller.js";
import { createMockPlatform } from "./mocks/controller.js";
import { createMockAccessory, createMockService } from "./mocks/homebridge.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "../src/settings.js";

// Helper to create a valid controller options object.
function createControllerOptions(overrides: Record<string, unknown> = {}) {

  return {
    address: "192.168.1.1",
    mqttTopic: "unifi/access",
    password: "test",
    username: "admin",
    ...overrides
  };
}

describe("AccessController", () => {

  let platform: ReturnType<typeof createMockPlatform>;

  beforeEach(() => {

    platform = createMockPlatform();
  });

  describe("Constructor", () => {

    it("should initialize configuredDevices as an empty object", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      expect(controller.configuredDevices).toEqual({});
    });

    it("should store the config from accessOptions", () => {

      const options = createControllerOptions();
      const controller = new AccessController(platform as any, options as any);

      expect(controller.config).toBe(options);
    });

    it("should set the platform reference", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      expect(controller.platform).toBe(platform);
    });

    it("should initialize mqtt as null", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      expect(controller.mqtt).toBeNull();
    });

    it("should initialize logApiErrors as true", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      expect(controller.logApiErrors).toBe(true);
    });

    it("should initialize uda as an empty object", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      expect(controller.uda).toEqual({});
    });

    it("should use the name from options when provided", () => {

      const controller = new AccessController(platform as any, createControllerOptions({ name: "My Controller" }) as any);

      // The name is private, but it's used in log messages. We can verify through the log proxy.
      controller.log.info("Test message");

      expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining("My Controller"));
    });

    it("should fall back to address as name when name is not provided", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.log.info("Test message");

      expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining("192.168.1.1"));
    });

    it("should set up log methods that delegate to the platform", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.log.info("info message");
      controller.log.error("error message");
      controller.log.warn("warn message");
      controller.log.debug("debug message");

      expect(platform.log.info).toHaveBeenCalled();
      expect(platform.log.error).toHaveBeenCalled();
      expect(platform.log.warn).toHaveBeenCalled();
      expect(platform.debug).toHaveBeenCalled();
    });
  });

  describe("id getter", () => {

    it("should return undefined when uda host is not set", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      expect(controller.id).toBeUndefined();
    });

    it("should return the MAC address uppercase without colons when uda.host.mac is set", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "aa:bb:cc:dd:ee:ff" } } as any;

      expect(controller.id).toBe("AABBCCDDEEFF");
    });

    it("should handle a MAC address that is already uppercase", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "00:11:22:33:44:55" } } as any;

      expect(controller.id).toBe("001122334455");
    });
  });

  describe("deviceLookup", () => {

    it("should return null when no devices are configured", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      expect(controller.deviceLookup("some-device-id")).toBeNull();
    });

    it("should return null when the device ID is not found", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      (controller.configuredDevices as any)["uuid-1"] = { uda: { unique_id: "device-1" } };
      (controller.configuredDevices as any)["uuid-2"] = { uda: { unique_id: "device-2" } };

      expect(controller.deviceLookup("device-3")).toBeNull();
    });

    it("should return the device when the device ID matches", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      const mockDevice = { uda: { unique_id: "device-1" } };

      (controller.configuredDevices as any)["uuid-1"] = mockDevice;

      expect(controller.deviceLookup("device-1")).toBe(mockDevice);
    });

    it("should return the correct device when multiple devices are configured", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      const device1 = { uda: { unique_id: "device-1" } };
      const device2 = { uda: { unique_id: "device-2" } };
      const device3 = { uda: { unique_id: "device-3" } };

      (controller.configuredDevices as any)["uuid-1"] = device1;
      (controller.configuredDevices as any)["uuid-2"] = device2;
      (controller.configuredDevices as any)["uuid-3"] = device3;

      expect(controller.deviceLookup("device-2")).toBe(device2);
    });
  });

  describe("hasFeature", () => {

    it("should delegate to featureOptions.test with controller ID when no device is provided", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "00:11:22:33:44:55" } } as any;
      controller.hasFeature("Device");

      expect(platform.featureOptions.test).toHaveBeenCalledWith("Device", "001122334455", "001122334455");
    });

    it("should delegate to featureOptions.test with device MAC when a device is provided", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "00:11:22:33:44:55" } } as any;

      const device = { mac: "AA:BB:CC:DD:EE:FF" } as any;

      controller.hasFeature("Device", device);

      expect(platform.featureOptions.test).toHaveBeenCalledWith("Device", "AABBCCDDEEFF", "001122334455");
    });

    it("should return the value from featureOptions.test", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      platform.featureOptions.test.mockReturnValue(false);

      expect(controller.hasFeature("Device")).toBe(false);
    });

    it("should use controller ID as fallback when device has no mac", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "00:11:22:33:44:55" } } as any;

      const device = {} as any;

      controller.hasFeature("Device", device);

      expect(platform.featureOptions.test).toHaveBeenCalledWith("Device", "001122334455", "001122334455");
    });
  });

  describe("getFeatureNumber", () => {

    it("should delegate to featureOptions.getInteger with the controller ID", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "00:11:22:33:44:55" } } as any;
      controller.getFeatureNumber("Controller.DelayDeviceRemoval");

      expect(platform.featureOptions.getInteger).toHaveBeenCalledWith("Controller.DelayDeviceRemoval", "001122334455");
    });

    it("should return the value from featureOptions.getInteger", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      platform.featureOptions.getInteger.mockReturnValue(60);

      expect(controller.getFeatureNumber("Controller.DelayDeviceRemoval")).toBe(60);
    });

    it("should return null when no value is configured", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      platform.featureOptions.getInteger.mockReturnValue(null);

      expect(controller.getFeatureNumber("Controller.DelayDeviceRemoval")).toBeNull();
    });
  });

  describe("getFeatureFloat", () => {

    it("should delegate to featureOptions.getFloat with the controller ID", () => {

      const controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "00:11:22:33:44:55" } } as any;
      controller.getFeatureFloat("SomeFloat");

      expect(platform.featureOptions.getFloat).toHaveBeenCalledWith("SomeFloat", "001122334455");
    });
  });

  describe("removeHomeKitDevice", () => {

    let controller: AccessController;

    beforeEach(() => {

      controller = new AccessController(platform as any, createControllerOptions() as any);

      controller.uda = { host: { mac: "00:11:22:33:44:55" } } as any;

      // Give the controller a mock udaApi so the removal logic can look up device names.
      (controller as any).udaApi = {
        devices: [],
        getDeviceName: vi.fn(() => "Test Device"),
        getFullName: vi.fn(() => "Test Device")
      };
    });

    it("should skip removal if the accessory is not in platform.accessories", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "00:11:22:33:44:55";

      // The accessory is NOT in the platform accessories array.
      controller.removeHomeKitDevice(accessory as any);

      expect(platform.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    });

    it("should skip removal if the accessory controller does not match", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "FF:FF:FF:FF:FF:FF";
      platform.accessories.push(accessory);

      controller.removeHomeKitDevice(accessory as any);

      expect(platform.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    });

    it("should remove the accessory when it is valid and matches the controller", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "00:11:22:33:44:55";
      platform.accessories.push(accessory);

      // Mock getFeatureNumber to return 0 (no delay).
      platform.featureOptions.getInteger.mockReturnValue(0);

      controller.removeHomeKitDevice(accessory as any, true);

      expect(platform.api.unregisterPlatformAccessories).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    });

    it("should remove the accessory from the platform accessories array", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "00:11:22:33:44:55";
      platform.accessories.push(accessory);

      platform.featureOptions.getInteger.mockReturnValue(0);

      controller.removeHomeKitDevice(accessory as any, true);

      expect(platform.accessories).not.toContain(accessory);
    });

    it("should call cleanup on the configured device if it exists", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "00:11:22:33:44:55";
      platform.accessories.push(accessory);

      const mockDevice = { accessory, accessoryName: "Test Device", cleanup: vi.fn(), uda: { alias: "Test", unique_id: "dev-1" } };

      (controller.configuredDevices as any)["test-uuid"] = mockDevice;

      platform.featureOptions.getInteger.mockReturnValue(0);

      controller.removeHomeKitDevice(accessory as any, true);

      expect(mockDevice.cleanup).toHaveBeenCalled();
    });

    it("should delete the device from configuredDevices after removal", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "00:11:22:33:44:55";
      platform.accessories.push(accessory);

      (controller.configuredDevices as any)["test-uuid"] = { accessory, cleanup: vi.fn(), uda: null };

      platform.featureOptions.getInteger.mockReturnValue(0);

      controller.removeHomeKitDevice(accessory as any, true);

      expect(controller.configuredDevices["test-uuid"]).toBeUndefined();
    });

    it("should call updatePlatformAccessories after removal", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "00:11:22:33:44:55";
      platform.accessories.push(accessory);

      platform.featureOptions.getInteger.mockReturnValue(0);

      controller.removeHomeKitDevice(accessory as any, true);

      expect(platform.api.updatePlatformAccessories).toHaveBeenCalled();
    });

    it("should queue device for delayed removal when noRemovalDelay is false and delay is configured", () => {

      const accessory = createMockAccessory("test-uuid");

      accessory.context.controller = "00:11:22:33:44:55";
      platform.accessories.push(accessory);

      // Return a delay of 60 seconds.
      platform.featureOptions.getInteger.mockReturnValue(60);

      controller.removeHomeKitDevice(accessory as any, false);

      // The device should NOT be removed yet - it's queued.
      expect(platform.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
      expect(platform.accessories).toContain(accessory);
    });
  });
});
