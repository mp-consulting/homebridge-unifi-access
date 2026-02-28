import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_CONTROLLER_REFRESH_INTERVAL,
  ACCESS_CONTROLLER_RETRY_INTERVAL,
  ACCESS_DEVICE_REMOVAL_DELAY_INTERVAL,
  ACCESS_DEVICE_UNLOCK_INTERVAL,
  ACCESS_MOTION_DURATION,
  ACCESS_MQTT_RECONNECT_INTERVAL,
  ACCESS_MQTT_TOPIC,
  ACCESS_OCCUPANCY_DURATION,
  HK_CHARACTERISTIC_REVERT_DELAY_MS,
  PLATFORM_NAME,
  PLUGIN_NAME,
  createPrefixedLogger,
  isValidAddress,
  normalizeMac
} from "../src/settings.js";

describe("Plugin identity constants", () => {

  it("should have the correct PLUGIN_NAME", () => {

    expect(PLUGIN_NAME).toBe("@mp-consulting/homebridge-unifi-access");
  });

  it("should have the correct PLATFORM_NAME", () => {

    expect(PLATFORM_NAME).toBe("UniFi Access");
  });

  it("should have the correct ACCESS_MQTT_TOPIC", () => {

    expect(ACCESS_MQTT_TOPIC).toBe("unifi/access");
  });
});

describe("Interval constants", () => {

  const intervals = {

    ACCESS_CONTROLLER_REFRESH_INTERVAL,
    ACCESS_CONTROLLER_RETRY_INTERVAL,
    ACCESS_MOTION_DURATION,
    ACCESS_MQTT_RECONNECT_INTERVAL,
    ACCESS_OCCUPANCY_DURATION,
    HK_CHARACTERISTIC_REVERT_DELAY_MS
  };

  it.each(Object.entries(intervals))("%s should be a positive number", (_name, value) => {

    expect(typeof value).toBe("number");
    expect(value).toBeGreaterThan(0);
  });

  it("ACCESS_DEVICE_REMOVAL_DELAY_INTERVAL should be a non-negative number", () => {

    expect(typeof ACCESS_DEVICE_REMOVAL_DELAY_INTERVAL).toBe("number");
    expect(ACCESS_DEVICE_REMOVAL_DELAY_INTERVAL).toBeGreaterThanOrEqual(0);
  });

  it("ACCESS_DEVICE_UNLOCK_INTERVAL should be a non-negative number", () => {

    expect(typeof ACCESS_DEVICE_UNLOCK_INTERVAL).toBe("number");
    expect(ACCESS_DEVICE_UNLOCK_INTERVAL).toBeGreaterThanOrEqual(0);
  });
});

describe("Interval constant values", () => {

  it("should refresh controllers every 120 seconds", () => {

    expect(ACCESS_CONTROLLER_REFRESH_INTERVAL).toBe(120);
  });

  it("should retry controller bootstrap every 10 seconds", () => {

    expect(ACCESS_CONTROLLER_RETRY_INTERVAL).toBe(10);
  });

  it("should default device removal delay to 60 seconds", () => {

    expect(ACCESS_DEVICE_REMOVAL_DELAY_INTERVAL).toBe(60);
  });

  it("should default unlock interval to 0 minutes", () => {

    expect(ACCESS_DEVICE_UNLOCK_INTERVAL).toBe(0);
  });

  it("should default motion duration to 10 seconds", () => {

    expect(ACCESS_MOTION_DURATION).toBe(10);
  });

  it("should reconnect MQTT every 60 seconds", () => {

    expect(ACCESS_MQTT_RECONNECT_INTERVAL).toBe(60);
  });

  it("should default occupancy duration to 300 seconds", () => {

    expect(ACCESS_OCCUPANCY_DURATION).toBe(300);
  });

  it("should default HomeKit characteristic revert delay to 50 ms", () => {

    expect(HK_CHARACTERISTIC_REVERT_DELAY_MS).toBe(50);
  });
});

describe("normalizeMac", () => {

  it("should strip colons and uppercase a standard MAC address", () => {

    expect(normalizeMac("aa:bb:cc:dd:ee:ff")).toBe("AABBCCDDEEFF");
  });

  it("should handle already-normalized MAC addresses", () => {

    expect(normalizeMac("AABBCCDDEEFF")).toBe("AABBCCDDEEFF");
  });

  it("should handle mixed case MAC addresses", () => {

    expect(normalizeMac("aA:Bb:cC:Dd:eE:Ff")).toBe("AABBCCDDEEFF");
  });

  it("should handle MAC addresses without colons", () => {

    expect(normalizeMac("aabbccddeeff")).toBe("AABBCCDDEEFF");
  });

  it("should handle an empty string", () => {

    expect(normalizeMac("")).toBe("");
  });
});

describe("createPrefixedLogger", () => {

  const createMockLog = () => ({

    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  });

  it("should prefix messages with the name returned by nameGetter", () => {

    const mockLog = createMockLog();
    const mockDebug = vi.fn();
    const logger = createPrefixedLogger(mockLog as never, mockDebug, () => "TestDevice");

    logger.info("hello");
    expect(mockLog.info).toHaveBeenCalledWith("TestDevice: hello");
  });

  it("should format parameters using util.format", () => {

    const mockLog = createMockLog();
    const mockDebug = vi.fn();
    const logger = createPrefixedLogger(mockLog as never, mockDebug, () => "Dev");

    logger.warn("value is %s", 42);
    expect(mockLog.warn).toHaveBeenCalledWith("Dev: value is 42");
  });

  it("should route debug messages through the debug function", () => {

    const mockLog = createMockLog();
    const mockDebug = vi.fn();
    const logger = createPrefixedLogger(mockLog as never, mockDebug, () => "Hub");

    logger.debug("test debug");
    expect(mockDebug).toHaveBeenCalledWith("Hub: test debug");
    expect(mockLog.debug).not.toHaveBeenCalled();
  });

  it("should route error messages through platformLog.error", () => {

    const mockLog = createMockLog();
    const mockDebug = vi.fn();
    const logger = createPrefixedLogger(mockLog as never, mockDebug, () => "Hub");

    logger.error("something failed");
    expect(mockLog.error).toHaveBeenCalledWith("Hub: something failed");
  });

  it("should use the current name from nameGetter (dynamic)", () => {

    const mockLog = createMockLog();
    const mockDebug = vi.fn();
    let name = "Before";
    const logger = createPrefixedLogger(mockLog as never, mockDebug, () => name);

    logger.info("first");
    expect(mockLog.info).toHaveBeenCalledWith("Before: first");

    name = "After";
    logger.info("second");
    expect(mockLog.info).toHaveBeenCalledWith("After: second");
  });
});

describe("isValidAddress", () => {

  it("should accept valid private IPv4 addresses", () => {

    expect(isValidAddress("192.168.1.1")).toBe(true);
    expect(isValidAddress("10.0.0.1")).toBe(true);
    expect(isValidAddress("172.16.0.1")).toBe(true);
  });

  it("should accept valid hostnames", () => {

    expect(isValidAddress("unifi.local")).toBe(true);
    expect(isValidAddress("access.example.com")).toBe(true);
  });

  it("should reject empty and falsy values", () => {

    expect(isValidAddress("")).toBe(false);
    expect(isValidAddress("  ")).toBe(false);
    expect(isValidAddress(null as unknown as string)).toBe(false);
    expect(isValidAddress(undefined as unknown as string)).toBe(false);
  });

  it("should reject localhost", () => {

    expect(isValidAddress("localhost")).toBe(false);
    expect(isValidAddress("Localhost")).toBe(false);
    expect(isValidAddress("LOCALHOST")).toBe(false);
  });

  it("should reject loopback addresses", () => {

    expect(isValidAddress("127.0.0.1")).toBe(false);
    expect(isValidAddress("127.0.1.1")).toBe(false);
    expect(isValidAddress("127.255.255.255")).toBe(false);
  });

  it("should reject link-local addresses", () => {

    expect(isValidAddress("169.254.1.1")).toBe(false);
    expect(isValidAddress("169.254.0.0")).toBe(false);
  });

  it("should reject the unspecified address", () => {

    expect(isValidAddress("0.0.0.0")).toBe(false);
  });

  it("should reject IPv6 addresses", () => {

    expect(isValidAddress("[::1]")).toBe(false);
    expect(isValidAddress("::1")).toBe(false);
    expect(isValidAddress("fe80::1")).toBe(false);
  });

  it("should reject non-string types", () => {

    expect(isValidAddress(123 as unknown as string)).toBe(false);
    expect(isValidAddress({} as unknown as string)).toBe(false);
  });

  it("should handle addresses with leading/trailing whitespace", () => {

    expect(isValidAddress("  192.168.1.1  ")).toBe(true);
    expect(isValidAddress("  localhost  ")).toBe(false);
  });
});
