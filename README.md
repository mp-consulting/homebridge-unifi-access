<div align="center">

![homebridge-unifi-access: Native HomeKit support for UniFi Access](docs/media/homebridge-unifi-access.svg)

# Homebridge UniFi Access

[![Downloads](https://img.shields.io/npm/dt/@mp-consulting/homebridge-unifi-access?color=%230559C9&logo=icloud&logoColor=%23FFFFFF&style=for-the-badge)](https://www.npmjs.com/package/@mp-consulting/homebridge-unifi-access)
[![Version](https://img.shields.io/npm/v/@mp-consulting/homebridge-unifi-access?color=%230559C9&label=Latest%20Version&logo=ubiquiti&logoColor=%23FFFFFF&style=for-the-badge)](https://www.npmjs.com/package/@mp-consulting/homebridge-unifi-access)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![License](https://img.shields.io/npm/l/@mp-consulting/homebridge-unifi-access?color=%230559C9&logo=open%20source%20initiative&logoColor=%23FFFFFF&style=for-the-badge)](LICENSE.md)

Complete HomeKit support for the [UniFi Access](https://ui.com/door-access) ecosystem using [Homebridge](https://homebridge.io).

</div>

## Table of Contents

- [About](#about)
- [Supported Devices](#supported-devices)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## About

`@mp-consulting/homebridge-unifi-access` is a [Homebridge](https://homebridge.io) plugin that provides HomeKit support for [Ubiquiti's](https://www.ui.com) [UniFi Access](https://ui.com/door-access) door access security platform — including doorbell, reader, lock, and controller hardware.

This plugin discovers all your supported UniFi Access devices and makes them available in HomeKit with minimal configuration. It supports all known UniFi Access controller configurations (UniFi CloudKey Gen2+, UniFi Dream Machine Pro/SE, UniFi NVR, etc.) and uses the native UniFi Access events API for realtime event capturing.

## Supported Devices

| Device | Capabilities |
|--------|-------------|
| **UA Hub** | Lock, doorbell, door position sensor (DPS), terminal inputs (REL, REN, REX) |
| **UA Hub Door Mini** | Lock, door position sensor (DPS), request to exit sensor (REX) |
| **UA Ultra** | Lock, door position sensor (DPS), request to exit sensor (REX) |
| **UA Gate** | Main gate (lock or garage door opener), side door (pedestrian gate) with separate lock, door position sensors for both doors |
| **UA Readers** | Access method switches for Face, Hand Wave, Mobile, NFC, PIN, and QR |

## Features

- **Easy configuration** - provide your controller IP address, username, and password to get started
- **Full HomeKit support** - locks, doorbells, door position sensors, terminal inputs, access method switches, and automation accelerators
- **Automatic name sync** - device and door names from UniFi Access are automatically reflected in HomeKit, including per-door names for multi-door hubs like the UA Gate
- **Multiple controllers** - seamlessly integrate several UniFi Access controllers into HomeKit
- **Realtime device detection** - automatically adds and removes devices in HomeKit as they change on your controller, without restarting Homebridge
- **Customizable** - [feature options](docs/FeatureOptions.md) let you show/hide specific devices and tailor behavior via the built-in webUI
- **MQTT support** - publish events to an [MQTT broker](docs/MQTT.md) for further automation

## Prerequisites

- [Homebridge](https://homebridge.io) >= 1.8.0
- Node.js >= 18
- A UniFi Access controller running the **latest stable firmware**
- A local user account on the controller (recommended over Ubiquiti cloud credentials; 2FA is not supported)

## Installation

### Via Homebridge UI (recommended)

1. Open the Homebridge UI
2. Go to the **Plugins** tab
3. Search for `@mp-consulting/homebridge-unifi-access`
4. Click **Install**

### Via CLI

```sh
npm install -g @mp-consulting/homebridge-unifi-access
```

## Configuration

The recommended way to configure the plugin is through the [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x). For manual configuration, add the following to the `platforms` array in your Homebridge `config.json`:

```json
{
    "platform": "UniFi Access",
    "name": "UniFi Access",
    "controllers": [
        {
            "address": "1.2.3.4",
            "username": "homebridge",
            "password": "your-password-here"
        }
    ]
}
```

> A sample configuration file is available at [`config.sample.json`](tests/fixtures/config.sample.json).

### Optional Settings

| Setting | Description |
|---------|-------------|
| `controllers[].name` | Custom name for the controller (used in logs) |
| `controllers[].mqttUrl` | MQTT broker URL (e.g. `mqtt://1.2.3.4`) |
| `controllers[].mqttTopic` | MQTT base topic (default: `unifi/access`) |
| `options` | Array of [feature options](docs/FeatureOptions.md) for granular control |
| `ringDelay` | Delay in seconds between doorbell rings (default: `0`) |

## Documentation

- [Feature Options](docs/FeatureOptions.md) - show/hide devices and customize behavior
- [MQTT](docs/MQTT.md) - configure MQTT event publishing
- [Events](docs/Events.md) - UniFi Access event types and payloads
- [UniFi Access API](https://www.npmjs.com/package/unifi-access) - native API library
- [Changelog](CHANGELOG.md) - release notes and version history

## Contributing

```sh
# Install dependencies
npm install

# Build
npm run build

# Run linter
npm run lint

# Run tests
npm test

# Start in dev mode with live reload
npm run watch
```

### Event Schema Monitor

A live monitoring script is included to detect UniFi Access API changes across firmware updates. It connects to a controller, listens to real-time events, and validates each message against known schemas — reporting any new fields, missing fields, or type changes.

```sh
# Uses credentials from tests/hbConfig/config.json
npm run monitor:events

# Or point to a different Homebridge config
npm run monitor:events -- --config /path/to/config.json

# Or specify credentials directly
npm run monitor:events -- --address 192.168.1.1 --username admin --password secret

# Save raw event payloads to tmp/events/ for debugging
npm run monitor:events -- --dump
```

Sample output:

```
2026-02-28T23:02:09.004Z OK DEVICE_REMOTE_UNLOCK event_object_id=6c63f8431750
2026-02-28T23:02:09.007Z OK DEVICE_UPDATE_V2 event_object_id=3de83e52-...
2026-02-28T23:02:09.008Z MISMATCH LOCATION_UPDATE event_object_id=c87d8d81-...
  + data.new_field: unexpected_field — Type: string
```

When mismatches are found, update the schemas in `tests/event-schemas.ts` (the single source of truth) and the type definitions in `src/hub/access-hub-types.ts` to match the new API.

## License

[MIT](LICENSE.md)
