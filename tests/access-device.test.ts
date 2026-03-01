import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccessDevice } from "../src/access-device.js";
import type { AccessDeviceConfig } from "unifi-access";
import { AccessReservedNames } from "../src/access-types.js";
import { ACCESS_MOTION_DURATION, ACCESS_OCCUPANCY_DURATION } from "../src/settings.js";
import { createMockController } from "./mocks/controller.js";
import { createMockAccessory, createMockService } from "./mocks/homebridge.js";
import { createMockDeviceConfig, createMockEnterprise } from "./mocks/unifi-access.js";

// Concrete test subclass since AccessDevice is abstract.
class TestDevice extends AccessDevice {

  public uda: AccessDeviceConfig;

  constructor(controller: any, accessory: any, deviceConfig: AccessDeviceConfig) {

    super(controller, accessory);
    this.uda = deviceConfig;
  }

  // Expose protected methods for testing.
  public testConfigureHints(): boolean {

    return this.configureHints();
  }

  public testSetInfo(accessory: any, device: AccessDeviceConfig): boolean {

    return this.setInfo(accessory, device);
  }
}

describe("AccessDevice", () => {

  let controller: ReturnType<typeof createMockController>;
  let accessory: ReturnType<typeof createMockAccessory>;
  let deviceConfig: AccessDeviceConfig;
  let device: TestDevice;

  beforeEach(() => {

    controller = createMockController();
    accessory = createMockAccessory();
    deviceConfig = createMockDeviceConfig();
    device = new TestDevice(controller as any, accessory as any, deviceConfig);
  });

  describe("id getter", () => {

    it("should return MAC without colons for a UAH device", () => {

      expect(device.id).toBe("AABBCCDDEEFF");
    });

    it("should strip colons from various MAC formats", () => {

      device.uda = createMockDeviceConfig({ mac: "11:22:33:44:55:66" });

      expect(device.id).toBe("112233445566");
    });

    it("should append source_id for an Enterprise (UAH-Ent) device", () => {

      device.uda = createMockEnterprise({ mac: "AA:BB:CC:DD:EE:FF", source_id: "1" });

      expect(device.id).toBe("AABBCCDDEEFF-1");
    });

    it("should uppercase the source_id for Enterprise devices", () => {

      device.uda = createMockEnterprise({ mac: "AA:BB:CC:DD:EE:FF", source_id: "abc" });

      expect(device.id).toBe("AABBCCDDEEFF-ABC");
    });

    it("should not append source_id for non-Enterprise device types", () => {

      // Default mock is UAH, which does not append source_id.
      device.uda = createMockDeviceConfig({ mac: "AA:BB:CC:DD:EE:FF", source_id: "5" });

      expect(device.id).toBe("AABBCCDDEEFF");
    });
  });

  describe("name getter", () => {

    it("should delegate to udaApi.getFullName with the device config", () => {

      controller.udaApi.getFullName.mockReturnValue("Full Device Name");

      const name = device.name;

      expect(name).toBe("Full Device Name");
      expect(controller.udaApi.getFullName).toHaveBeenCalledWith(deviceConfig);
    });

    it("should return the alias via getFullName when alias is set", () => {

      controller.udaApi.getFullName.mockImplementation((d: AccessDeviceConfig) => d.alias ?? d.name);

      expect(device.name).toBe("Test Device");
    });

    it("should return the name via getFullName when alias is not set", () => {

      device.uda = createMockDeviceConfig({ alias: "" });
      controller.udaApi.getFullName.mockImplementation((d: AccessDeviceConfig) => d.alias || d.name);

      expect(device.name).toBe("Test Hub");
    });
  });

  describe("isOnline getter", () => {

    it("should return true when all four flags are true", () => {

      device.uda = createMockDeviceConfig({
        is_adopted: true,
        is_connected: true,
        is_managed: true,
        is_online: true
      });

      expect(device.isOnline).toBe(true);
    });

    it("should return false when is_adopted is false", () => {

      device.uda = createMockDeviceConfig({ is_adopted: false });

      expect(device.isOnline).toBe(false);
    });

    it("should return false when is_connected is false", () => {

      device.uda = createMockDeviceConfig({ is_connected: false });

      expect(device.isOnline).toBe(false);
    });

    it("should return false when is_managed is false", () => {

      device.uda = createMockDeviceConfig({ is_managed: false });

      expect(device.isOnline).toBe(false);
    });

    it("should return false when is_online is false", () => {

      device.uda = createMockDeviceConfig({ is_online: false });

      expect(device.isOnline).toBe(false);
    });

    it("should return false when all four flags are false", () => {

      device.uda = createMockDeviceConfig({
        is_adopted: false,
        is_connected: false,
        is_managed: false,
        is_online: false
      });

      expect(device.isOnline).toBe(false);
    });

    it("should return false when multiple flags are false", () => {

      device.uda = createMockDeviceConfig({ is_adopted: false, is_online: false });

      expect(device.isOnline).toBe(false);
    });
  });

  describe("isReservedName", () => {

    it("should return true for all reserved names", () => {

      for(const reservedName of Object.values(AccessReservedNames)) {

        expect(device.isReservedName(reservedName)).toBe(true);
      }
    });

    it("should be case-insensitive", () => {

      expect(device.isReservedName("contactsensor.dps")).toBe(true);
      expect(device.isReservedName("CONTACTSENSOR.DPS")).toBe(true);
      expect(device.isReservedName("ContactSensor.DPS")).toBe(true);
      expect(device.isReservedName("contactSENSOR.dps")).toBe(true);
    });

    it("should return false for undefined", () => {

      expect(device.isReservedName(undefined)).toBe(false);
    });

    it("should return false for non-reserved names", () => {

      expect(device.isReservedName("NotReserved")).toBe(false);
      expect(device.isReservedName("RandomName")).toBe(false);
      expect(device.isReservedName("")).toBe(false);
    });

    it("should return false for partial matches of reserved names", () => {

      expect(device.isReservedName("ContactSensor")).toBe(false);
      expect(device.isReservedName("DPS")).toBe(false);
      expect(device.isReservedName("Lock")).toBe(false);
    });

    it("should return true for specific reserved names", () => {

      expect(device.isReservedName(AccessReservedNames.CONTACT_DPS)).toBe(true);
      expect(device.isReservedName(AccessReservedNames.LOCK_DOOR_SIDE)).toBe(true);
      expect(device.isReservedName(AccessReservedNames.SWITCH_DOORBELL_TRIGGER)).toBe(true);
      expect(device.isReservedName(AccessReservedNames.SWITCH_MOTION_SENSOR)).toBe(true);
      expect(device.isReservedName(AccessReservedNames.SWITCH_MOTION_TRIGGER)).toBe(true);
      expect(device.isReservedName(AccessReservedNames.SWITCH_LOCK_TRIGGER)).toBe(true);
      expect(device.isReservedName(AccessReservedNames.SWITCH_ACCESSMETHOD_FACE)).toBe(true);
      expect(device.isReservedName(AccessReservedNames.SWITCH_ACCESSMETHOD_NFC)).toBe(true);
    });
  });

  describe("accessoryName getter", () => {

    it("should return the Name characteristic value when set", () => {

      accessory.getService(controller.hap.Service.AccessoryInformation)
        .updateCharacteristic(controller.hap.Characteristic.Name, "Custom Name");

      expect(device.accessoryName).toBe("Custom Name");
    });

    it("should fall back to uda.alias when Name characteristic is not set", () => {

      // The mock characteristic starts with null value, which is falsy, so it falls through to alias.
      device.uda = createMockDeviceConfig({ alias: "My Alias" });

      expect(device.accessoryName).toBe("My Alias");
    });

    it("should fall back to 'Unknown' when neither Name characteristic nor alias is set", () => {

      device.uda = createMockDeviceConfig({ alias: "" }) as any;
      // Force alias to be falsy.
      (device.uda as any).alias = undefined;

      expect(device.accessoryName).toBe("Unknown");
    });
  });

  describe("accessoryName setter", () => {

    it("should set the displayName on both accessory and HAP accessory", () => {

      device.accessoryName = "New Name";

      expect(accessory.displayName).toBe("New Name");
      expect(accessory._associatedHAPAccessory.displayName).toBe("New Name");
    });

    it("should update the Name characteristic on the AccessoryInformation service", () => {

      device.accessoryName = "Updated Name";

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

      expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.Name, "Updated Name");
    });

    it("should propagate name changes to all services on the accessory", () => {

      // Set the initial accessory name via the alias fallback.
      device.uda = createMockDeviceConfig({ alias: "Old Name" });

      // Create mock services with old name prefix.
      const contactService = createMockService("ContactSensor", "ContactSensor.DPS");

      contactService.displayName = "Old Name Door Position Sensor";

      const lockService = createMockService("LockMechanism");

      lockService.displayName = "Old Name";

      // Include the AccessoryInformation service and our test services.
      accessory.services = [accessory.getService(controller.hap.Service.AccessoryInformation), contactService, lockService];

      // Set the new name.
      device.accessoryName = "New Name";

      // Verify both services got renamed.
      expect(contactService.displayName).toBe("New Name Door Position Sensor");
      expect(contactService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.Name, "New Name Door Position Sensor");
      expect(lockService.displayName).toBe("New Name");
      expect(lockService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.Name, "New Name");
    });

    it("should update ConfiguredName when the service has it", () => {

      device.uda = createMockDeviceConfig({ alias: "Old Name" });

      const switchService = createMockService("Switch", "LockTrigger");

      switchService.displayName = "Old Name Lock Trigger";
      switchService.testCharacteristic.mockReturnValue(true);

      accessory.services = [accessory.getService(controller.hap.Service.AccessoryInformation), switchService];

      device.accessoryName = "New Name";

      expect(switchService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.ConfiguredName, "New Name Lock Trigger");
    });

    it("should not update services whose displayName does not start with the old name", () => {

      device.uda = createMockDeviceConfig({ alias: "Old Name" });

      const unrelatedService = createMockService("Switch", "some-subtype");

      unrelatedService.displayName = "Unrelated Service";

      accessory.services = [accessory.getService(controller.hap.Service.AccessoryInformation), unrelatedService];

      device.accessoryName = "New Name";

      expect(unrelatedService.displayName).toBe("Unrelated Service");
      expect(unrelatedService.updateCharacteristic).not.toHaveBeenCalledWith(controller.hap.Characteristic.Name, expect.anything());
    });

  });

  describe("cleanup", () => {

    it("should remove all registered event listeners", () => {

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      (device as any).listeners = { "event-1": handler1, "event-2": handler2 };

      device.cleanup();

      expect(controller.events.removeListener).toHaveBeenCalledWith("event-1", handler1);
      expect(controller.events.removeListener).toHaveBeenCalledWith("event-2", handler2);
      expect(Object.keys((device as any).listeners)).toHaveLength(0);
    });

    it("should continue cleanup even if removeListener throws", () => {

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      (device as any).listeners = { "event-1": handler1, "event-2": handler2 };

      controller.events.removeListener.mockImplementationOnce(() => { throw new Error("mock error"); });

      device.cleanup();

      // The second listener should still be cleaned up despite the first one throwing.
      expect(controller.events.removeListener).toHaveBeenCalledWith("event-2", handler2);
      expect(Object.keys((device as any).listeners)).toHaveLength(0);
    });

    it("should log debug when removeListener throws", () => {

      const handler = vi.fn();

      (device as any).listeners = { "event-1": handler };

      controller.events.removeListener.mockImplementationOnce(() => { throw new Error("mock error"); });

      device.cleanup();

      // debug messages route through platform.debug (via createPrefixedLogger).
      expect(controller.platform.debug).toHaveBeenCalledWith(expect.stringContaining("Failed to remove event listener for event-1"));
    });
  });

  describe("configureHints", () => {

    it("should return true", () => {

      expect(device.testConfigureHints()).toBe(true);
    });

    it("should set default motion duration from ACCESS_MOTION_DURATION", () => {

      controller.platform.featureOptions.getInteger.mockReturnValue(null);

      device.testConfigureHints();

      expect(device.hints.motionDuration).toBe(ACCESS_MOTION_DURATION);
    });

    it("should set default occupancy duration from ACCESS_OCCUPANCY_DURATION", () => {

      controller.platform.featureOptions.getInteger.mockReturnValue(null);

      device.testConfigureHints();

      expect(device.hints.occupancyDuration).toBe(ACCESS_OCCUPANCY_DURATION);
    });

    it("should use a custom motion duration when provided", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.Duration") {

          return 30;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.motionDuration).toBe(30);
    });

    it("should use a custom occupancy duration when provided", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.OccupancySensor.Duration") {

          return 600;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.occupancyDuration).toBe(600);
    });

    it("should enforce a minimum motion duration of 2 seconds", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.Duration") {

          return 1;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.motionDuration).toBe(2);
    });

    it("should enforce a minimum motion duration of 2 when set to 0", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.Duration") {

          return 0;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.motionDuration).toBe(2);
    });

    it("should allow motion duration of exactly 2", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.Duration") {

          return 2;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.motionDuration).toBe(2);
    });

    it("should enforce a minimum occupancy duration of 60 seconds", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.OccupancySensor.Duration") {

          return 30;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.occupancyDuration).toBe(60);
    });

    it("should enforce a minimum occupancy duration of 60 when set to 0", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.OccupancySensor.Duration") {

          return 0;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.occupancyDuration).toBe(60);
    });

    it("should allow occupancy duration of exactly 60", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.OccupancySensor.Duration") {

          return 60;
        }

        return null;
      });

      device.testConfigureHints();

      expect(device.hints.occupancyDuration).toBe(60);
    });

    it("should set syncName from feature option", () => {

      controller.hasFeature.mockReturnValue(true);

      device.testConfigureHints();

      expect(device.hints.syncName).toBe(true);
    });

    it("should log when syncName is disabled", () => {

      controller.hasFeature.mockReturnValue(false);

      device.testConfigureHints();

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining("Device name synchronization with HomeKit is disabled."));
    });

    it("should log when motion duration differs from default", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.Duration") {

          return 20;
        }

        return null;
      });

      device.testConfigureHints();

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining("Motion event duration set to"));
    });

    it("should log when occupancy duration differs from default", () => {

      controller.platform.featureOptions.getInteger.mockImplementation((option: string) => {

        if(option === "Motion.OccupancySensor.Duration") {

          return 600;
        }

        return null;
      });

      device.testConfigureHints();

      expect(controller.platform.log.info).toHaveBeenCalledWith(expect.stringContaining("Occupancy event duration set to"));
    });

    it("should not log motion duration when it matches the default", () => {

      controller.platform.featureOptions.getInteger.mockReturnValue(null);
      controller.hasFeature.mockReturnValue(false);

      device.testConfigureHints();

      const calls = controller.platform.log.info.mock.calls.map((c: unknown[]) => String(c[0]));

      expect(calls.some((msg: string) => msg.includes("Motion event duration"))).toBe(false);
    });

    it("should not log occupancy duration when it matches the default", () => {

      controller.platform.featureOptions.getInteger.mockReturnValue(null);
      controller.hasFeature.mockReturnValue(false);

      device.testConfigureHints();

      const calls = controller.platform.log.info.mock.calls.map((c: unknown[]) => String(c[0]));

      expect(calls.some((msg: string) => msg.includes("Occupancy event duration"))).toBe(false);
    });

    it("should set enabled hint from Device feature option", () => {

      controller.hasFeature.mockImplementation((option: string) => option === "Device");

      device.testConfigureHints();

      expect(device.hints.enabled).toBe(true);
    });

    it("should set logMotion hint from Log.Motion feature option", () => {

      controller.hasFeature.mockImplementation((option: string) => option === "Log.Motion");

      device.testConfigureHints();

      expect(device.hints.logMotion).toBe(true);
    });
  });

  describe("setInfo", () => {

    it("should return true", () => {

      expect(device.testSetInfo(accessory, deviceConfig)).toBe(true);
    });

    it("should set the manufacturer to 'Ubiquiti Inc.'", () => {

      device.testSetInfo(accessory, deviceConfig);

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

      expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.Manufacturer, "Ubiquiti Inc.");
    });

    it("should set the model from display_model when available", () => {

      const config = createMockDeviceConfig({ display_model: "UA Hub" });

      device.testSetInfo(accessory, config);

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

      expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.Model, "UA Hub");
    });

    it("should fall back to model when display_model is not set", () => {

      const config = createMockDeviceConfig({ display_model: undefined, model: "UAH" } as any);

      device.testSetInfo(accessory, config);

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

      expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.Model, "UAH");
    });

    it("should not set model when neither display_model nor model is set", () => {

      const config = createMockDeviceConfig({ display_model: undefined, model: undefined } as any);

      device.testSetInfo(accessory, config);

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);
      const modelCalls = infoService.updateCharacteristic.mock.calls.filter(
        (c: unknown[]) => c[0] === controller.hap.Characteristic.Model
      );

      expect(modelCalls).toHaveLength(0);
    });

    it("should set serial number from MAC address without colons and uppercased", () => {

      const config = createMockDeviceConfig({ mac: "aa:bb:cc:dd:ee:ff" });

      device.testSetInfo(accessory, config);

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

      expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.SerialNumber, "AABBCCDDEEFF");
    });

    it("should not set serial number when MAC is empty", () => {

      const config = createMockDeviceConfig({ mac: "" });

      device.testSetInfo(accessory, config);

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);
      const serialCalls = infoService.updateCharacteristic.mock.calls.filter(
        (c: unknown[]) => c[0] === controller.hap.Characteristic.SerialNumber
      );

      expect(serialCalls).toHaveLength(0);
    });

    describe("firmware revision parsing", () => {

      it("should parse 'v3.0.0' as '3.0.0'", () => {

        const config = createMockDeviceConfig({ firmware: "v3.0.0" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "3.0.0");
      });

      it("should parse 'v3.0' as '3.0.0'", () => {

        const config = createMockDeviceConfig({ firmware: "v3.0" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "3.0.0");
      });

      it("should parse 'v3' as '3.0.0'", () => {

        const config = createMockDeviceConfig({ firmware: "v3" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "3.0.0");
      });

      it("should parse 'v1.2.3' as '1.2.3'", () => {

        const config = createMockDeviceConfig({ firmware: "v1.2.3" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "1.2.3");
      });

      it("should parse 'v1.2.3.beta1' as '1.2.3'", () => {

        const config = createMockDeviceConfig({ firmware: "v1.2.3.beta1" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "1.2.3");
      });

      it("should parse 'v10.20.30' as '10.20.30'", () => {

        const config = createMockDeviceConfig({ firmware: "v10.20.30" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "10.20.30");
      });

      it("should use the raw firmware string when it does not match the version regex", () => {

        const config = createMockDeviceConfig({ firmware: "3.0.0" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "3.0.0");
      });

      it("should use the raw firmware string for non-standard formats", () => {

        const config = createMockDeviceConfig({ firmware: "custom-build-123" });

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

        expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.FirmwareRevision, "custom-build-123");
      });

      it("should not set firmware revision when firmware is empty", () => {

        const config = createMockDeviceConfig({ firmware: "" } as any);

        device.testSetInfo(accessory, config);

        const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);
        const fwCalls = infoService.updateCharacteristic.mock.calls.filter(
          (c: unknown[]) => c[0] === controller.hap.Characteristic.FirmwareRevision
        );

        expect(fwCalls).toHaveLength(0);
      });
    });
  });

  describe("configureInfo", () => {

    it("should return true", () => {

      device.hints.syncName = false;

      expect(device.configureInfo()).toBe(true);
    });

    it("should call setInfo with the accessory and device config", () => {

      device.hints.syncName = false;

      device.configureInfo();

      const infoService = accessory.getService(controller.hap.Service.AccessoryInformation);

      // Verify that setInfo was called by checking that Manufacturer was set.
      expect(infoService.updateCharacteristic).toHaveBeenCalledWith(controller.hap.Characteristic.Manufacturer, "Ubiquiti Inc.");
    });

    it("should sync the name to HomeKit when syncName hint is enabled and alias exists", () => {

      device.hints.syncName = true;
      device.uda = createMockDeviceConfig({ alias: "My Custom Door" });

      device.configureInfo();

      // The accessoryName setter should have been invoked, updating displayName and the Name characteristic.
      expect(accessory.displayName).toBe("My Custom Door");
      expect(accessory._associatedHAPAccessory.displayName).toBe("My Custom Door");
    });

    it("should not sync the name when syncName hint is disabled", () => {

      device.hints.syncName = false;
      device.uda = createMockDeviceConfig({ alias: "My Custom Door" });

      // Set a known displayName before calling configureInfo.
      accessory.displayName = "Original Name";

      device.configureInfo();

      // displayName should not have changed (the setter was not called).
      expect(accessory.displayName).toBe("Original Name");
    });

    it("should not sync the name when alias is empty", () => {

      device.hints.syncName = true;
      device.uda = createMockDeviceConfig({ alias: "" });

      accessory.displayName = "Original Name";

      device.configureInfo();

      expect(accessory.displayName).toBe("Original Name");
    });

    it("should not sync the name when alias is undefined", () => {

      device.hints.syncName = true;
      device.uda = createMockDeviceConfig({});
      (device.uda as any).alias = undefined;

      accessory.displayName = "Original Name";

      device.configureInfo();

      expect(accessory.displayName).toBe("Original Name");
    });
  });
});
