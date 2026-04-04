# CLAUDE.md

## Project Overview

Homebridge plugin (`@mp-consulting/homebridge-unifi-access`) providing HomeKit support for Ubiquiti's UniFi Access door access system. Supports locks, doorbells, sensors, readers, and hubs with automatic discovery, real-time events, and MQTT publishing.

## Tech Stack

- **Language**: TypeScript (strict, ES2022, ESM via NodeNext)
- **Runtime**: Node.js >= 20, Homebridge >= 1.8.0
- **Testing**: Vitest with v8 coverage
- **Linting**: ESLint 9 flat config with typescript-eslint
- **Key deps**: `unifi-access` (API client), `homebridge-plugin-utils` (HBUP utilities)

## Commands

- `npm run build` — Clean and compile TypeScript
- `npm run lint` — Lint with zero warnings
- `npm test` — Run tests (Vitest)
- `npm run test:coverage` — Tests with coverage
- `npm run watch` — Build, link, and watch with nodemon
- `npm run start` — Build and launch Homebridge with test config
- `npm run monitor:events` — Run event schema monitor script

## Project Structure

```
src/
├── index.ts                    # Plugin entry point
├── access-platform.ts          # AccessPlatform (DynamicPlatformPlugin)
├── access-controller.ts        # Controller connection & device orchestration
├── access-device.ts            # Base device class
├── access-device-catalog.ts    # Device capability definitions
├── access-events.ts            # WebSocket event handling
├── access-types.ts             # Type/enum definitions
├── access-options.ts           # Feature options & config types
├── settings.ts                 # Constants & utilities
└── hub/                        # Hub-specific implementations
    ├── access-hub.ts           # Hub state & orchestration
    ├── access-hub-api.ts       # Hub API interactions
    ├── access-hub-services.ts  # HomeKit service configuration
    ├── access-hub-events.ts    # Hub event handlers
    ├── access-hub-mqtt.ts      # MQTT integration
    ├── access-hub-utils.ts     # Utility functions
    └── access-hub-types.ts     # Type definitions
test/
├── *.test.ts                   # Unit tests
├── mocks/                      # Homebridge, UniFi Access, controller mocks
└── fixtures/                   # Test data
docs/
├── feature-options.md          # Feature options reference
├── mqtt.md                     # MQTT configuration
└── events.md                   # Event types and payloads
homebridge-ui/                  # Custom config UI with discovery wizard
```

## Architecture

- **Platform → Controller → Device/Hub** hierarchy
- **Hub specialization**: `AccessHub` extends `AccessDevice` with dedicated sub-modules (API, services, events, MQTT)
- **Event-driven**: WebSocket subscriptions for real-time state updates
- **Feature options**: Per-device and per-controller capability toggles via `homebridge-plugin-utils`
- **Device catalog**: Maps device models (DPS, REL, REN, REX) to capabilities
- **Per-door naming**: Multi-door hubs (UA Gate) expose individual door accessories
- **Custom UI**: Uses Homebridge custom UI framework (`homebridge-ui/`) for plugin configuration management

## Code Style

- Single quotes, 2-space indent, semicolons required
- Trailing commas in multiline, max line length 160
- Unix line endings, object curly spacing
- Copyright headers: dual-line — `Copyright(C) 2017-2026, HJD` then `Copyright(C) 2026, Mickael Palma / MP Consulting`

## Git Settings

- `coAuthoredBy`: false
