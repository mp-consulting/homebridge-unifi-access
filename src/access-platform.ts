/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-platform.ts: homebridge-unifi-access platform class.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { type AccessOptions, featureOptionCategories, featureOptions } from './access-options.js';
import { ACCESS_MQTT_TOPIC, ACCESS_TLS_PIN_FILE, isAccessIdentifier } from './settings.js';
import { AccessTlsPinStore } from './unifi/index.js';
import { APIEvent } from 'homebridge';
import { AccessController } from './access-controller.js';
import { FeatureOptions } from './lib/index.js';
import path from 'node:path';
import util from 'node:util';

export class AccessPlatform implements DynamicPlatformPlugin {

  public accessories: PlatformAccessory[];
  public readonly api: API;
  public readonly config: AccessOptions;
  private readonly controllers: AccessController[];
  public readonly featureOptions: FeatureOptions;
  public readonly log: Logging;
  public readonly tlsPins: AccessTlsPinStore;

  constructor(log: Logging, config: PlatformConfig | undefined, api: API) {

    this.accessories = [];
    this.api = api;
    this.controllers = [];
    this.featureOptions = new FeatureOptions(featureOptionCategories, featureOptions, config?.options ?? [], { isIdentifier: isAccessIdentifier });
    this.log = log;

    // Trust-on-first-use TLS certificate pins for our controllers, persisted in the Homebridge storage path and shared across all controllers.
    this.tlsPins = new AccessTlsPinStore(path.join(api.user.storagePath(), ACCESS_TLS_PIN_FILE), (message: string) => this.log.error(message));

    // Plugin options into our config variables.
    this.config = {

      controllers: config?.controllers ?? [],
      debugAll: false,
      options: config?.options ?? [],
      ringDelay: config?.ringDelay ?? 0,
    };

    // We need a UniFi Access controller configured to do anything.
    if(!this.config.controllers.length) {

      this.log.info('No UniFi Access controllers have been configured.');

      return;
    }

    // Debugging - most people shouldn't enable this.
    this.debug('Debug logging on. Expect a lot of data.');

    // Loop through each configured controller and instantiate it.
    for(const controllerConfig of this.config.controllers) {

      // We need an address, or there's nothing to do.
      if(!controllerConfig.address) {

        this.log.info('No host or IP address has been configured.');

        continue;
      }

      // We need login credentials or we're skipping this one.
      if(!controllerConfig.username || !controllerConfig.password) {

        this.log.info('No UniFi Access login credentials have been configured.');

        continue;
      }

      // MQTT topic to use.
      controllerConfig.mqttTopic ||= ACCESS_MQTT_TOPIC;

      this.controllers.push(new AccessController(this, controllerConfig));
    }

    // Avoid a prospective race condition by waiting to configure our controllers until Homebridge is done loading all the cached accessories it knows
    // about, and calling configureAccessory() on each.
    api.on(APIEvent.DID_FINISH_LAUNCHING, this.launchControllers.bind(this));

    // Release our timers and network connections when Homebridge shuts down.
    api.on(APIEvent.SHUTDOWN, () => this.controllers.forEach(controller => controller.shutdown()));
  }

  // This gets called when homebridge restores cached accessories at startup. We intentionally avoid doing anything significant here, and save all that logic
  // for device discovery.
  public configureAccessory(accessory: PlatformAccessory): void {

    // Add this to the accessory array so we can track it.
    this.accessories.push(accessory);
  }

  // Launch our configured controllers once all accessories have been loaded. Once we do, they will sustain themselves.
  private launchControllers(): void {

    // Iterate through all our controllers and startup.
    for(const controller of this.controllers) {

      // Login to the Access controller.
      void controller.login().catch((error: Error) => this.log.error('Access controller login error: %s.', error.message));
    }
  }

  // Utility for debug logging. We always route to Homebridge's debug log, which only formats and emits messages when Homebridge runs in debug mode (-D). The
  // debugAll override promotes debug messages to the info level so they're visible regardless.
  public debug(message: string, ...parameters: unknown[]): void {

    if(this.config.debugAll) {

      this.log.info(util.format(message, ...parameters));

      return;
    }

    this.log.debug(message, ...parameters);
  }
}
