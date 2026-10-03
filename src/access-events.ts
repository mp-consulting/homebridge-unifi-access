/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-events.ts: Events class for UniFi Access.
 */
import type { HAP } from 'homebridge';
import type { AccessApi, AccessDeviceConfig, AccessEventPacket } from './unifi/index.js';
import { AccessEventType } from './access-types.js';
import { type HomebridgePluginLogging, sanitizeName } from './lib/index.js';
import type { AccessController } from './access-controller.js';
import { EventEmitter } from 'node:events';

// Event map for typed EventEmitter support. All Access events carry an AccessEventPacket payload.
// The string index signature covers dynamic event names (device IDs, combined event+device keys).
type AccessEventMap = Record<string, [AccessEventPacket]>;

export class AccessEvents extends EventEmitter<AccessEventMap> {

  private controller: AccessController;
  private eventsHandler: ((packet: AccessEventPacket) => void) | null;
  private hap: HAP;
  private log: HomebridgePluginLogging;
  private mqttPublishTelemetry: boolean;
  private udaApi: AccessApi;
  private udaUpdatesHandler: ((packet: AccessEventPacket) => void) | null;

  // Initialize an instance of our Access events handler.
  constructor(controller: AccessController) {

    super();

    this.hap = controller.platform.api.hap;
    this.log = controller.log;
    this.mqttPublishTelemetry = controller.hasFeature('Controller.Publish.Telemetry');
    this.controller = controller;
    this.udaApi = controller.udaApi;
    this.eventsHandler = null;
    this.udaUpdatesHandler = null;

    // If we've enabled telemetry from the controller inform the user.
    if(this.mqttPublishTelemetry) {

      this.log.info('Access controller telemetry enabled.');
    }

    this.configureEvents();
  }

  // Process Access API update events.
  private udaUpdates(packet: AccessEventPacket): void {

    // Lookup the device.
    const accessDevice = this.controller.deviceLookup(packet.event_object_id);

    // We have the device, let's check for device updates.
    if(accessDevice) {

      // Update our device configuration state.
      accessDevice.uda = packet.data as AccessDeviceConfig;

      // If we have services on the accessory associated with the Access device that have a StatusActive characteristic set, update our availability state.
      accessDevice.accessory.services.filter(x => x.testCharacteristic(this.hap.Characteristic.StatusActive))
        .map(x => x.updateCharacteristic(this.hap.Characteristic.StatusActive, accessDevice.isOnline));

      // Sync names, if configured to do so.
      if(accessDevice.hints.syncName && accessDevice.resolvedName && (accessDevice.accessoryName !== sanitizeName(accessDevice.resolvedName))) {

        accessDevice.log.info('Name change detected. A restart of Homebridge may be needed in order to complete name synchronization with HomeKit.');
        accessDevice.configureInfo();

        // Persist the new names to the accessory cache.
        this.controller.platform.api.updatePlatformAccessories([ accessDevice.accessory, ...accessDevice.childAccessories ]);
      }
    }
  }

  // Process device additions and removals from the Access events API.
  private manageDevices(packet: AccessEventPacket): void {

    // Lookup the device.
    const accessDevice = this.controller.deviceLookup(packet.event_object_id);

    // We're unadopting.
    if(packet.event === AccessEventType.DEVICE_DELETE) {

      // If it's already gone, we're done.
      if(!accessDevice) {

        return;
      }

      // Remove the device.
      this.controller.removeHomeKitDevice(accessDevice.accessory);

      return;
    }
  }

  // Listen to the UniFi Access events API for updates we are interested in (e.g. unlock).
  private configureEvents(): boolean {

    // Only configure the event listener if it exists and it's not already configured.
    if(this.eventsHandler && this.udaUpdatesHandler) {

      return true;
    }

    // Ensure we update our UDA state before we process any other events.
    this.prependListener(AccessEventType.DEVICE_UPDATE, this.udaUpdatesHandler = this.udaUpdates.bind(this));

    // Process remove events.
    this.prependListener(AccessEventType.DEVICE_DELETE, this.manageDevices.bind(this));

    // Listen for any messages coming in from our listener. We route events to the appropriate handlers based on the type of event that comes across.
    this.udaApi.on('message', this.eventsHandler = (packet: AccessEventPacket): void => {

      // Emit messages based on the event type.
      this.emit(packet.event, packet);

      // Emit messages based on the specific device.
      this.emit(packet.event_object_id, packet);

      // For v2 device update events, we need to unpack the metadata to determine which device we're targeting.
      if((packet.event === AccessEventType.DEVICE_UPDATE_V2) && (packet.meta?.object_type === 'device')) {

        this.emit(packet.meta.id, packet);
      }

      // Finally, emit messages based on the specific event and device combination.
      this.emit(packet.event + '.' + packet.event_object_id, packet);

      // If enabled, publish all the event traffic coming from the Access controller to MQTT.
      if(this.mqttPublishTelemetry) {

        this.controller.mqtt?.publish(this.controller.id ?? '', 'telemetry', this.sanitizeTelemetry(packet));
      }
    });

    return true;
  }

  // Sanitize an event packet for MQTT telemetry, stripping raw data that may contain sensitive information.
  private sanitizeTelemetry(packet: AccessEventPacket): string {

    return JSON.stringify({

      event: packet.event,
      event_object_id: packet.event_object_id,  
      ...(packet.meta ? { meta: { id: packet.meta.id, object_type: packet.meta.object_type } } : {}),  
    });
  }
}
