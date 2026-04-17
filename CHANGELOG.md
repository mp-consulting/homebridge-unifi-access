# Changelog

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
