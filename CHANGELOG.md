# Changelog

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
