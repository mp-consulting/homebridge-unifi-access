/* Copyright(C) 2026, Mickael Palma. All rights reserved.
 *
 * settings.ts: Settings and constants for homebridge-unifi-access.
 */
import type { HomebridgePluginLogging } from "homebridge-plugin-utils";
import type { Logging } from "homebridge";
import util from "node:util";

// The name of our plugin.
export const PLUGIN_NAME = "@mp-consulting/homebridge-unifi-access";

// The platform the plugin creates.
export const PLATFORM_NAME = "UniFi Access";

// How often, in seconds, should we check Access controllers for new or removed devices.
export const ACCESS_CONTROLLER_REFRESH_INTERVAL = 120;

// How often, in seconds, should we retry getting our bootstrap configuration from the Access controller.
export const ACCESS_CONTROLLER_RETRY_INTERVAL = 10;

// Default delay, in seconds, before removing Access devices that no longer exist.
export const ACCESS_DEVICE_REMOVAL_DELAY_INTERVAL = 60;

// Default delay, in minutes, before locking an unlocked door relay.
export const ACCESS_DEVICE_UNLOCK_INTERVAL = 0;

// Default duration, in seconds, of motion events. Setting this too low will potentially cause a lot of notification spam.
export const ACCESS_MOTION_DURATION = 10;

// How often, in seconds, should we try to reconnect with an MQTT broker, if we have one configured.
export const ACCESS_MQTT_RECONNECT_INTERVAL = 60;

// Default MQTT topic to use when publishing events. This is in the form of: unifi/access/MAC/event
export const ACCESS_MQTT_TOPIC = "unifi/access";

// Default duration, in seconds, of occupancy events.
export const ACCESS_OCCUPANCY_DURATION = 300;

// Delay, in milliseconds, before reverting a HomeKit characteristic value after a failed or no-op set.
export const HK_CHARACTERISTIC_REVERT_DELAY_MS = 50;

// Normalize a MAC address by stripping colons and uppercasing.
export function normalizeMac(mac: string): string {

  return mac.replace(/:/g, "").toUpperCase();
}

// Validate a controller address, rejecting loopback, link-local, and unspecified addresses.
export function isValidAddress(address: string): boolean {

  if(!address || (typeof address !== "string")) {

    return false;
  }

  const trimmed = address.trim().toLowerCase();

  if(!trimmed || (trimmed === "localhost") || trimmed.startsWith("127.") || trimmed.startsWith("169.254.") || (trimmed === "0.0.0.0") ||
    trimmed.startsWith("[") || trimmed.includes("::")) {

    return false;
  }

  return true;
}

// Factory for the prefixed logging adapter pattern used across devices and controllers.
export function createPrefixedLogger(platformLog: Logging, debugFn: (message: string, ...parameters: unknown[]) => void,
  nameGetter: () => string): HomebridgePluginLogging {

  return {

    debug: (message: string, ...parameters: unknown[]): void => debugFn(util.format(nameGetter() + ": " + message, ...parameters)),
    error: (message: string, ...parameters: unknown[]): void => platformLog.error(util.format(nameGetter() + ": " + message, ...parameters)),
    info: (message: string, ...parameters: unknown[]): void => platformLog.info(util.format(nameGetter() + ": " + message, ...parameters)),
    warn: (message: string, ...parameters: unknown[]): void => platformLog.warn(util.format(nameGetter() + ": " + message, ...parameters))
  };
}
