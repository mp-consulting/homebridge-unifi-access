# Porting Provenance

This plugin has **zero runtime dependencies**. Everything it needs beyond Node.js built-ins is implemented in-repo. Most of that code was ported from upstream
packages at specific versions, and this document records exactly where each piece came from, what was changed, and how to sync against upstream in the future.

## Upstream baselines

| In-repo location | Ported from | Version | Upstream source |
|---|---|---|---|
| `src/unifi/` | `unifi-access` | 1.5.3 | https://github.com/hjdhjd/unifi-access |
| `src/lib/featureoptions.ts`, `src/lib/mqttclient.ts`, `src/lib/service.ts`, `src/lib/util.ts` | `homebridge-plugin-utils` | 1.35.0 | https://github.com/hjdhjd/homebridge-plugin-utils |
| `src/lib/ui-server.ts` | `@homebridge/plugin-ui-utils` (server class) | 2.2.3 | https://github.com/homebridge/plugin-ui-utils |
| `src/lib/request.ts`, `src/lib/websocket.ts`, `src/lib/mqtt-connection.ts` | original implementations | — | replace `undici` and `mqtt` usage |

## Transport replacement

Upstream `unifi-access` was built on undici. The port replaces that transport with in-repo primitives:

- undici `Pool` with `connect: { rejectUnauthorized: false }` → `https.Agent({ keepAlive: true, maxSockets: 5, rejectUnauthorized })`, recreated in `reset()`.
- undici's retry interceptor → the retry policy in `src/lib/request.ts`: `{ factor: 2, maxRetries: 5, maxTimeout: 1500, minTimeout: 100, statusCodes: [ 400,
  404, 429, 500, 502, 503, 504 ] }`, matching the status codes upstream retried (UniFi OS transiently returns 400 and 404 while services restart).
- undici error classes → Node error `.code` checks (`ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `EHOSTDOWN`), with timeouts driven by an `AbortController`.
- undici `WebSocket` → `src/lib/websocket.ts`, an RFC 6455 client on Node's `http(s)` upgrade mechanism supporting self-signed TLS endpoints.
- The undici user-agent interceptor → a `user-agent` header set during header initialization in `logout()`.

## Deliberate deviations from upstream

Everything not listed here is a faithful port. The deviations:

### `src/unifi/` (from unifi-access 1.5.3)

- `updateDevice()` and the `isAdminUser` getter were not ported — the plugin never calls them, and upstream never actually sets `_isAdminUser` to `true`, making
  `updateDevice()` unreachable there as well.
- undici `TypeError` special-casing in the events WebSocket handler dropped (impossible with the local WebSocket client); all WebSocket errors are logged.
- **Added** (not in upstream): the `verifyTls` constructor option enabling strict TLS certificate validation across the API connection and the events WebSocket.

### `src/lib/` shared files (from homebridge-plugin-utils 1.35.0 / @homebridge/plugin-ui-utils 2.2.3)

- `MqttClient` is API-identical to upstream but runs on the in-repo `MqttConnection` (MQTT 3.1.1 over `net`/`tls`) instead of the `mqtt` package. One
  consequence: MQTT-over-WebSocket broker URLs (`ws://`, `wss://`), which mqtt.js accepted, are not supported - only `mqtt://`, `mqtts://`, `tcp://`, and
  `ssl://` - and are rejected with an explicit "Unsupported protocol" error.
- `HomebridgePluginUiServer`'s parent-disconnect watchdog (SIGTERM when the Homebridge UI's IPC channel goes away) is an unref'd 10-second `process.connected`
  poll installed in the constructor, rather than upstream's module-scope interval plus `disconnect` listener. The module is re-exported through the shared
  library barrel that the main plugin imports, where `process.connected` is undefined and the module-scope form would terminate Homebridge itself.
- **Added** (not in upstream): `WebSocketClient` enforces a configurable maximum message size (default 64 MiB, fragmentation-aware) and force-closes
  connections when a peer never completes the close handshake; `MqttConnection`'s keepalive doubles as a liveness watchdog (two silent intervals tear down the
  connection for reconnect), the broker must answer CONNECT with a CONNACK within 30 seconds, inbound packets are bounds-checked and capped at 16 MiB, and
  protocol violations tear down the connection for reconnect rather than trusting broker-declared lengths.

## Keeping the shared library in sync

`src/lib` (excluding `index.ts`) is deliberately duplicated between
[homebridge-unifi-access](https://github.com/mp-consulting/homebridge-unifi-access) and
[homebridge-unifi-protect](https://github.com/mp-consulting/homebridge-unifi-protect) rather than shared through an npm package, to preserve the zero-dependency
posture. `scripts/check-lib-sync.sh` (run in CI as the `lib-sync` job) fails the build if the copies drift. When changing a shared file, apply the identical
change in the sibling repository.

## Syncing against upstream

Upstream fixes no longer arrive automatically. To review what changed upstream since the baseline:

1. Diff the upstream repository between the baseline version above and its current release (e.g. `git log v1.5.3..HEAD` in hjdhjd/unifi-access).
2. Port relevant changes by hand, honoring the deviations listed above.
3. `npm run monitor:events` watches the live controller event stream for schema drift that may indicate API changes worth investigating upstream.
4. Update the baseline table and deviations in this document afterward.
