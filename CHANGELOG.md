# Changelog

## [1.1.4] - 2026-09-10

### Changed

- **Dependencies**: Updated all dependencies to latest compatible versions, including the vendored `@mp-consulting/homebridge-ui-kit` ^1.0.1 used by the config UI, plus dev-only major bumps for `vitest` (4→5) and `@types/node` (25→26).

## [1.1.3] - 2026-08-10

### Fixed

- **The Homebridge log showed `[UniFi Access]` instead of `[UniFi Access]`**: Homebridge derives a plugin's log prefix from `name` in its platform config, falling back to the plugin alias when that key is absent. `config.schema.json` declared a `name` property but never listed it in `layout`, so the settings form never rendered the field and never wrote its default into `config.json`. `name` is now the first control in the form and defaults to `UniFi Access`.
- **404s in the browser console on every visit to the settings page**: the vendored minified Bootstrap files kept their trailing `sourceMappingURL` comment, so the browser asked for `bootstrap.min.css.map` and `bootstrap.bundle.min.js.map` and got a 404 for each. The copy step now strips the comment instead of shipping ~920 kB of source maps.

## [1.1.2] - 2026-08-09

### Fixed

- **Config UI rendered unstyled and its controls did nothing**: Bootstrap and Bootstrap Icons were loaded from `cdn.jsdelivr.net`, which the Homebridge UI's content-security policy refuses. Both stylesheets and the script were blocked, so the page lost its styling and `bootstrap` was never defined, leaving tabs, modals and collapses inert. All three are now vendored into the plugin and served from it, alongside the icon font.

## [1.1.1] - 2026-08-09

### Changed

- **Node.js support is now `^22.10.0 || ^24.0.0 || ^26.0.0`**: adds Node 26, which Homebridge 2.3.0 supports as of this release, and drops Node 20. Homebridge 2.x has never accepted Node 20 (it has required `^22 || ^24` since 2.0.0), so the previous range advertised a combination that could not actually run. CI now builds on Node 22.x, 24.x and 26.x.

## [1.1.0] - 2026-08-01

### Added

- **`verifyTls` controller option**: Per-controller opt-in TLS certificate validation for setups where the Access controller uses a certificate signed by a trusted certificate authority. Defaults to `false` (unchanged behavior), since UniFi controllers ship with self-signed certificates.

### Fixed

- **WebSocket shutdown races**: A transport error arriving after a consumer detached its listeners could raise an unhandled `error` event and crash the process; error events are now emitted only when listened for. Closing a WebSocket while its opening handshake was still in flight previously leaked the connection if the handshake later completed; the in-flight upgrade is now aborted and the connection discarded. A peer that sends a close frame but never completes the TCP shutdown no longer leaves the connection hung in the closing state.
- **MQTT robustness**: A malformed or truncated packet from the broker could throw inside the socket data handler and crash the process; all inbound packet parsing is now bounds-checked, broker-declared packet lengths are capped at 16 MiB, and protocol violations tear the connection down for reconnection. A broker that accepts the TCP connection but never answers with a CONNACK previously left the connection hung forever; it is now torn down after 30 seconds. MQTT-over-WebSocket broker URLs (unsupported by the in-repo client) are now rejected with a clear error instead of being reported as malformed.
- **Unlock response handling**: A successful unlock request returning an empty or non-JSON body (e.g. during a UniFi OS service restart) could raise an unhandled rejection through the MQTT lock command path and crash the process; the response is now parsed defensively.
- **Config UI with no adopted devices**: A controller that bootstraps successfully with zero adopted Access devices no longer breaks the discovery wizard.
- **Config UI server lifecycle**: The custom UI server child process now terminates itself when the Homebridge UI that spawned it goes away, instead of lingering as an orphan.

### Changed

- **Zero runtime dependencies**: The plugin no longer depends on any external npm packages at runtime. The `unifi-access` API client has been replaced by a minimal in-repo implementation (`src/unifi/`) covering login, bootstrap enumeration, device unlocks, and the realtime events WebSocket. The `homebridge-plugin-utils` utilities (feature options engine, MQTT client, HomeKit service helpers, and general utilities) and the `@homebridge/plugin-ui-utils` UI server base class are now implemented in-repo (`src/lib/`), including dependency-free HTTPS, WebSocket (RFC 6455), and MQTT 3.1.1 clients built exclusively on Node.js built-ins.

## [1.0.15] - 2026-05-01

### Fixed

- **UA Gate door discovery**: For multi-door UA Hub Gate setups, the plugin now resolves the main and side doors from the device's `port_setting` extensions (the controller's source of truth for which physical doors are wired to oper1/oper2). Orphan or stale door records left in the controller after renames or rebindings are now ignored, so the HomeKit unlock targets the correct relay and the correct UniFi door name is used.
- **GarageDoorOpener log**: Configuration log now includes the door name (e.g. "Configuring Portail as GarageDoorOpener service.") to match the existing side-door log style.

### Internal

- Added an info-level discovery summary on startup ("Discovered main door: … side door: …") and debug-level diagnostic logs for door/extension data.
- `logsInsightsAddSchema` now accepts the optional `data.id` field emitted by recent UniFi Access controller versions.

## [1.0.14] - 2026-04-17

### Changed

- **Dependencies**: Updated all dependencies to latest versions, including `homebridge-plugin-utils` (1.33→1.35)

## [1.0.13] - 2026-04-04

### Changed

- **Node.js**: Add Node.js 24.x support to CI matrix and standardize engines to `^20.18.0 || ^22.10.0 || ^24.0.0`

## [1.0.12] - 2026-03-30

### Changed

- **Dependencies**: Add `class-validator` as a direct dependency for `homebridge-config-ui-x` compatibility
- **Node.js**: Standardize `.tool-versions` to Node 20.22.2

## [1.0.11] - 2026-03-30

### Changed

- **Dependencies**: Updated all dependencies to latest versions including `@homebridge/plugin-ui-utils` 2.2.3, `homebridge-plugin-utils` 1.33.0, `eslint` ^10.1.0, `typescript` ^6.0.2, `vitest` ^4.1.2, and other dev dependencies.

## 1.0.10 (2026-03-26)

### Improvements

- Bump minimum Node.js requirement from 18 to 20
- Update `author` field to MP Consulting object format
- Bump `@types/node` to ^25.0.10
- Add `undici` 7.24.6 override to fix high-severity audit vulnerabilities
- Add `class-validator` dev dependency (required by homebridge-config-ui-x)
- Add `--passWithNoTests` flag to test script
- Add `*.mjs` glob to ESLint browser config for consistency

### Bug Fixes

- Fix event-schema-monitor crash: import path referenced `tests/` (plural) instead of `test/` (singular)
- Fix event-schema-monitor config parser not finding credentials when platform config is at the root level
- Fix test Homebridge config structure: platform config must be nested inside `platforms[]` array

## [1.0.9] - 2026-03-05

### Fixed

- **Config UI light mode**: Hardcoded `data-bs-theme="dark"` broke layout in light mode. Added early inline theme detection from `window.matchMedia` and confirmed via `homebridge.getUserSettings()` after ready.

## 1.0.8 (2026-03-04)

### Improvements

- Config UI migrated to homebridge-ui-kit design system (Bootstrap 5.3 + Bootstrap Icons, shared kit.css/kit.js, `data-bs-theme="dark"` dark mode)
- Standardize `.gitignore` and `.npmignore`

## 1.0.7 (2026-03-04)

### Features

- Gate opening triggered by a physical remote now initiates a full DPS-driven cycle in HomeKit: Opening → Open → (waits for gate to physically close) → Closing → Closed. Previously, a remote-triggered open jumped the GarageDoorOpener state directly to Open with no transition. Unlike the timer-driven cycle used for API/HomeKit triggers, this cycle waits for the DPS sensor to report close before transitioning, so HomeKit always reflects the real-world gate position regardless of how long the gate stays open.

## 1.0.6 (2026-03-04)

### Bug Fixes

- Fix door names not showing in HomeKit for main gate (GarageDoorOpener) and side door (LockMechanism) services. HomeKit requires the `ConfiguredName` characteristic to display custom names — it was missing on these service types, causing HomeKit to fall back to generic defaults ("Garage Door", "Lock").
- Fix `access-platform.test.ts` failing due to missing `@matter/nodejs` transitive dependency. The `APIEvent` const enum import from `homebridge` is now mocked to avoid triggering the full module resolution chain under esbuild.

## 1.0.5 (2026-03-01)

### Features

- 3-phase gate cycle for GarageDoorOpener: the gate duration is now split into three equal phases — Opening, Open, and Closing — giving accurate status in HomeKit. The door position sensor confirms the final Closed state.
- Post-close cooldown suppresses DPS bounce events after the gate settles, preventing spurious "open" flickers in HomeKit.
- Startup log messages and HomeKit service logs now use real door names from the Access API (e.g. "Portail locked" instead of "Gate locked").

### Improvements

- Gate cycle duration default changed from 30s to 90s to better match typical motorized gate timing.
- Updated GateDirectionDuration option description to reflect the 3-phase behavior.
- Door name discovery now runs early in the boot sequence so all log messages use real names.
- Added debug logging at all gate cycle decision points for easier troubleshooting.

### Bug Fixes

- Fix GarageDoorOpener showing "Opening/Closed" instead of the full Opening → Open → Closing → Closed progression.
- Fix side door DPS update events leaking through on UA Gate v1 device update packets.

## 1.0.4 (2026-03-01)

### Bug Fixes

- Fix spurious "Name change detected" log spam on every device update event for UA Gate hubs using per-door names.

## 1.0.3 (2026-03-01)

### Bug Fixes

- Fix side door unlock incorrectly updating the main door lock state in HomeKit for UA Gate hubs.
- Fix side door DPS contact sensor showing stale state after bootstrap initialization.

## 1.0.2 (2026-03-01)

### Features

- Name synchronization with HomeKit is now enabled by default (`Device.SyncName`).
- UA Gate hubs now use per-door names from the Access API (e.g. "Portail", "Portillon") for HomeKit service naming instead of the generic device alias. Names stay in sync when renamed in the Access controller.
- Gate direction tracking: GarageDoorOpener now shows transitional states (Opening/Closing) during gate movement for external triggers (NFC, remote, physical button).
- Event schema monitor supports `--dump` flag to save raw event payloads to disk for debugging.

### Improvements

- Accessory name changes now propagate to all HomeKit services, updating displayName, Name, and ConfiguredName characteristics.
- Side door DPS events now properly update the side door contact sensor in HomeKit.

## 1.0.1 (2026-03-01)

### Features

- Add gate direction duration feature option with configurable numeric values in the webUI.
- Add access method switches for Touch Pass (Apple Wallet).
- Add comprehensive [Events documentation](docs/Events.md) covering all 10 Access event types.

### Improvements

- Restructure the homebridge-ui client: split monolithic feature-options.js into scope, option-state, and renderer modules; reorganize app.js with grouped per-screen event bindings.
- Deduplicate dark mode CSS via custom properties, reducing ~90 lines of duplication.
- Add `el()` DOM builder helper and remove dead legacy `ui.mjs`.
- Unify hub lock/DPS state helpers with `isSideDoor` parameter, removing duplicate functions.
- Replace separate terminal input constants with a shared `terminalInputs` definition.
- Update event schemas for `DEVICE_UPDATE_V2` and `TOP_LOG_UPDATE` to match latest firmware.

### Bug Fixes

- Fix lint warnings: import sort order, object key ordering, and logical assignment operators.
- Add ESLint coverage for `feature-options/` subdirectory files.

## 1.0.0 (2026-02-28)

### Initial Release

- Full HomeKit support for UniFi Access devices: locks, doorbells, door position sensors, terminal inputs (REL, REN, REX), and access method switches.
- Automatic device discovery and realtime event handling via the UniFi Access events API.
- Support for UA Hub, UA Hub Door Mini, UA Ultra, and UA Gate (including side door / pedestrian gate).
- Access method switches for Face, Hand Wave, Mobile, NFC, PIN, QR, and Touch Pass.
- Feature options system for granular per-device and per-controller control.
- MQTT support for publishing and subscribing to device events.
- Homebridge webUI plugin with controller discovery, setup wizard, and feature options editor.
