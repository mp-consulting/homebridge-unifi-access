/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * settings.ts: Settings and constants for homebridge-unifi-access.
 */
import type { HomebridgePluginLogging } from './lib/index.js';
import type { Logging } from 'homebridge';
import util from 'node:util';

// The name of our plugin.
export const PLUGIN_NAME = '@mp-consulting/homebridge-unifi-access';

// The platform the plugin creates.
export const PLATFORM_NAME = 'UniFi Access';

// How often, in seconds, should we check Access controllers for new or removed devices.
export const ACCESS_CONTROLLER_REFRESH_INTERVAL = 120;

// How often, in seconds, should we retry getting our bootstrap configuration from the Access controller.
export const ACCESS_CONTROLLER_RETRY_INTERVAL = 10;

// Default delay, in seconds, before removing Access devices that no longer exist.
export const ACCESS_DEVICE_REMOVAL_DELAY_INTERVAL = 60;

// Default duration, in seconds, of the full gate cycle (open, hold, close) used for the 3-phase GarageDoorOpener state progression.
export const ACCESS_GATE_DIRECTION_DURATION = 90;

// Default delay, in minutes, before locking an unlocked door relay.
export const ACCESS_DEVICE_UNLOCK_INTERVAL = 0;

// File, within the Homebridge storage path, where we persist the TLS certificate fingerprints we've pinned for our controllers.
export const ACCESS_TLS_PIN_FILE = 'unifi-access-tls-pins.json';

// Default MQTT topic to use when publishing events. This is in the form of: unifi/access/MAC/event
export const ACCESS_MQTT_TOPIC = 'unifi/access';

// Delay, in milliseconds, before reverting a HomeKit characteristic value after a failed or no-op set.
export const HK_CHARACTERISTIC_REVERT_DELAY_MS = 50;

// Normalize a MAC address by stripping colons and uppercasing.
export function normalizeMac(mac: string): string {

  return mac.replace(/:/g, '').toUpperCase();
}

// Recognize the identifiers we scope feature options to: a MAC address without separators, optionally followed by a port for multi-door devices (e.g. UAH-Ent).
export function isAccessIdentifier(segment: string): boolean {

  return /^[0-9a-f]{12}(-[a-z0-9]+)?$/i.test(segment);
}

// Validate a controller address, rejecting loopback, link-local, and unspecified addresses.
export function isValidAddress(address: string): boolean {

  if(!address || (typeof address !== 'string')) {

    return false;
  }

  const trimmed = address.trim().toLowerCase();

  // We only accept a hostname or IPv4 address, optionally with a port. The address is spliced into the URLs we connect to, so anything else - credentials,
  // paths, fragments - could redirect where we send the user's login.
  if(!/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*\.?(:\d{1,5})?$/.test(trimmed)) {

    return false;
  }

  let host;

  // Let the URL parser canonicalize the host. This normalizes alternative IPv4 notations (e.g. 2130706433, 0177.0.0.1, or 127.1) into dotted-quad form so
  // they can't slip past the checks below.
  try {

    host = new URL('https://' + trimmed).hostname.replace(/\.$/, '');
  } catch {

    return false;
  }

  if((host === 'localhost') || host.endsWith('.localhost') || host.startsWith('127.') || host.startsWith('169.254.') || (host === '0.0.0.0')) {

    return false;
  }

  return true;
}

// Factory for the prefixed logging adapter pattern used across devices and controllers. The name is passed as a parameter rather than concatenated into the
// format string so that names containing format specifiers (e.g. '%') are logged verbatim. Debug messages are formatted lazily by the platform.
export function createPrefixedLogger(platformLog: Logging, debugFn: (message: string, ...parameters: unknown[]) => void,
  nameGetter: () => string): HomebridgePluginLogging {

  return {

    debug: (message: string, ...parameters: unknown[]): void => debugFn('%s: ' + message, nameGetter(), ...parameters),
    error: (message: string, ...parameters: unknown[]): void => platformLog.error(util.format('%s: ' + message, nameGetter(), ...parameters)),
    info: (message: string, ...parameters: unknown[]): void => platformLog.info(util.format('%s: ' + message, nameGetter(), ...parameters)),
    warn: (message: string, ...parameters: unknown[]): void => platformLog.warn(util.format('%s: ' + message, nameGetter(), ...parameters)),
  };
}
