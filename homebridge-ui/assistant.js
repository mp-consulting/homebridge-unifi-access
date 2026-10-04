/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * assistant.js: @mp-consulting/homebridge-unifi-access webUI Assistant routes.
 */
import { registerAiRoutes } from '@mp-consulting/homebridge-ai-kit/plugin';

export const ASSISTANT_PLUGIN_NAME = '@mp-consulting/homebridge-unifi-access';

// UniFi Access background the Assistant gets with every request from this plugin's webUI. Keep it short: it is sent with each prompt. The facts come from
// src/unifi (access-api.ts, access-api-tls.ts) and homebridge-ui/server.js.
export const UNIFI_ACCESS_AI_CONTEXT = [
  'The plugin bridges a UniFi Access controller (a UniFi OS console such as a UDM, UDM Pro, UDR, Cloud Key or UNVR running the Access application) and its',
  'devices (UA Hub, UA Hub Door Mini, UA Ultra, UA Gate, UA readers) to HomeKit as locks, doorbells, door position (DPS) and request-to-exit sensors and',
  'access method switches, with realtime updates over the controller\'s events WebSocket and optional MQTT publishing.',
  'Each entry in "controllers" has an address, username and password; it connects locally over HTTPS (port 443) to the UniFi OS API',
  '(/proxy/access/api/v2/...). Use a local user on the console whose role grants access to UniFi Access; Ubiquiti cloud (SSO) accounts with 2FA are not',
  'supported.',
  'Common errors: "Invalid login credentials given" is HTTP 401 (wrong username or password, or a cloud account); "Insufficient privileges for this user" is',
  'HTTP 403 (the user lacks an Access role); "Unable to connect to the Access controller. This is usually temporary and will occur during device reboots."',
  'covers 400, 404, 429 and 5xx answers (the Access application is not installed, updating or restarting); "Connection refused" (ECONNREFUSED or',
  'EHOSTDOWN) and "Hostname or IP address not found" (ENOTFOUND) mean a wrong address or the console is unreachable from Homebridge (VLAN, firewall);',
  '"Access controller is taking too long to respond" is a 3.5 second request timeout; after 10 consecutive errors the plugin pauses API calls for 5 minutes',
  '("Throttling API calls"). TLS: by default ("verifyTls" off) the console\'s self-signed certificate is pinned on first connection (trust on first use) in',
  'unifi-access-tls-pins.json in the Homebridge storage directory; "does not match the pinned certificate" or "Refusing TLS connection" means the',
  'certificate was regenerated (for example after a console reset or replacement; remove that controller\'s entry from the pin file) or the connection is',
  'being intercepted. "verifyTls" on requires a CA-signed certificate. Discovery uses the Ubiquiti discovery protocol (UDP port 10001) on local and nearby',
  'subnets, so consoles behind routers or firewalls may need to be added by address. A device shown as disconnected is offline in UniFi Access itself',
  '(power, PoE, cabling or adoption). Feature options ("options") enable or disable features per controller, hub or device. Never ask the user for their',
  'controller password, API keys or tokens.',
].join(' ');

// Adds the Assistant routes (/ai/status, /ai/explain, /ai/ask, /ai/config) to the webUI server. The provider settings come from the shared HomebridgeAiKit
// block in config.json; the key never reaches the browser. `options` is passed through to registerAiRoutes (tests inject a provider).
export function registerAssistant(server, options = {}) {

  registerAiRoutes(server, {

    pluginName: ASSISTANT_PLUGIN_NAME,
    systemContext: UNIFI_ACCESS_AI_CONTEXT,
    ...options,
  });
}
