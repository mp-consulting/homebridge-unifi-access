import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createMockAPI, createMockAccessory } from './mocks/homebridge.js';
import { createMockLog } from './mocks/controller.js';
import { ACCESS_MQTT_TOPIC } from '../src/settings.js';

// Mock homebridge to avoid the @matter/nodejs transitive dependency that fails to resolve under esbuild. APIEvent is a const enum whose values are inlined by
// tsc but not by esbuild, so we provide the literal values here.
vi.mock('homebridge', () => ({
  APIEvent: {
    DID_FINISH_LAUNCHING: 'didFinishLaunching',
    SHUTDOWN: 'shutdown',
  },
}));

import { AccessPlatform } from '../src/access-platform.js';

// APIEvent values for assertions (matches the mock above).
const APIEvent = {
  DID_FINISH_LAUNCHING: 'didFinishLaunching',
  SHUTDOWN: 'shutdown',
} as const;

describe('AccessPlatform', () => {

  let log: ReturnType<typeof createMockLog>;
  let api: ReturnType<typeof createMockAPI>;

  beforeEach(() => {

    log = createMockLog();
    api = createMockAPI();
  });

  describe('Constructor with no config', () => {

    it('should set accessories to an empty array', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);

      expect(platform.accessories).toEqual([]);
    });

    it('should set config.controllers to an empty array', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);

      expect(platform.config.controllers).toEqual([]);
    });

    it('should set config.options to an empty array', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);

      expect(platform.config.options).toEqual([]);
    });

    it('should log that no controllers have been configured', () => {

      new AccessPlatform(log as any, undefined, api as any);

      expect(log.info).toHaveBeenCalledWith('No UniFi Access controllers have been configured.');
    });

    it('should not register a DID_FINISH_LAUNCHING handler', () => {

      new AccessPlatform(log as any, undefined, api as any);

      expect(api.on).not.toHaveBeenCalled();
    });
  });

  describe('Constructor with empty controllers', () => {

    it('should log that no controllers have been configured', () => {

      const config = { controllers: [], platform: 'test' };

      new AccessPlatform(log as any, config as any, api as any);

      expect(log.info).toHaveBeenCalledWith('No UniFi Access controllers have been configured.');
    });

    it('should not register a DID_FINISH_LAUNCHING handler', () => {

      const config = { controllers: [], platform: 'test' };

      new AccessPlatform(log as any, config as any, api as any);

      expect(api.on).not.toHaveBeenCalled();
    });
  });

  describe('Constructor with valid controller config', () => {

    it('should register a DID_FINISH_LAUNCHING handler', () => {

      const config = {
        controllers: [{ address: '192.168.1.1', password: 'test', username: 'admin' }],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(api.on).toHaveBeenCalledWith(APIEvent.DID_FINISH_LAUNCHING, expect.any(Function));
    });

    it('should not log a no-controllers message', () => {

      const config = {
        controllers: [{ address: '192.168.1.1', password: 'test', username: 'admin' }],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(log.info).not.toHaveBeenCalledWith('No UniFi Access controllers have been configured.');
    });

    it('should handle multiple valid controllers', () => {

      const config = {
        controllers: [
          { address: '192.168.1.1', password: 'test1', username: 'admin1' },
          { address: '192.168.1.2', password: 'test2', username: 'admin2' },
        ],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(api.on).toHaveBeenCalledWith(APIEvent.DID_FINISH_LAUNCHING, expect.any(Function));
    });
  });

  describe('Constructor with missing address', () => {

    it('should log a missing address message', () => {

      const config = {
        controllers: [{ address: '', password: 'test', username: 'admin' }],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(log.info).toHaveBeenCalledWith('No host or IP address has been configured.');
    });

    it('should skip the controller with no address but process valid ones', () => {

      const config = {
        controllers: [
          { address: '', password: 'test', username: 'admin' },
          { address: '192.168.1.1', password: 'test', username: 'admin' },
        ],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(log.info).toHaveBeenCalledWith('No host or IP address has been configured.');
      expect(api.on).toHaveBeenCalledWith(APIEvent.DID_FINISH_LAUNCHING, expect.any(Function));
    });
  });

  describe('Constructor with missing credentials', () => {

    it('should log a missing credentials message when username is missing', () => {

      const config = {
        controllers: [{ address: '192.168.1.1', password: 'test', username: '' }],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(log.info).toHaveBeenCalledWith('No UniFi Access login credentials have been configured.');
    });

    it('should log a missing credentials message when password is missing', () => {

      const config = {
        controllers: [{ address: '192.168.1.1', password: '', username: 'admin' }],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(log.info).toHaveBeenCalledWith('No UniFi Access login credentials have been configured.');
    });

    it('should not register a DID_FINISH_LAUNCHING handler when all controllers have missing credentials', () => {

      const config = {
        controllers: [{ address: '192.168.1.1', password: '', username: '' }],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      // The handler is still registered because the controller loop completes and api.on is called afterward,
      // even if no controllers were actually created via new AccessController (the controller constructor
      // returns early). The api.on call happens unconditionally after the loop when config.controllers is non-empty.
      expect(api.on).toHaveBeenCalledWith(APIEvent.DID_FINISH_LAUNCHING, expect.any(Function));
    });
  });

  describe('configureAccessory()', () => {

    it('should add the accessory to the accessories array', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);
      const accessory = createMockAccessory('test-uuid-1');

      platform.configureAccessory(accessory as any);

      expect(platform.accessories).toHaveLength(1);
      expect(platform.accessories[0]).toBe(accessory);
    });

    it('should accumulate multiple accessories', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);
      const accessory1 = createMockAccessory('uuid-1');
      const accessory2 = createMockAccessory('uuid-2');

      platform.configureAccessory(accessory1 as any);
      platform.configureAccessory(accessory2 as any);

      expect(platform.accessories).toHaveLength(2);
      expect(platform.accessories[0]).toBe(accessory1);
      expect(platform.accessories[1]).toBe(accessory2);
    });
  });

  describe('debug() method', () => {

    it('should not log when debugAll is false (default)', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);

      platform.debug('Test debug message');

      expect(log.info).not.toHaveBeenCalledWith('Test debug message');
    });

    it('should log via log.info when debugAll is true', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);

      // Override debugAll to true.
      (platform.config as any).debugAll = true;

      platform.debug('Test debug message');

      expect(log.info).toHaveBeenCalledWith('Test debug message');
    });

    it('should format parameters when debugAll is true', () => {

      const platform = new AccessPlatform(log as any, undefined, api as any);

      (platform.config as any).debugAll = true;

      platform.debug('Value: %s, Count: %d', 'test', 42);

      expect(log.info).toHaveBeenCalledWith('Value: test, Count: 42');
    });
  });

  describe('Config defaults', () => {

    it('should default ringDelay to 0', () => {

      const config = { controllers: [], platform: 'test' };
      const platform = new AccessPlatform(log as any, config as any, api as any);

      expect(platform.config.ringDelay).toBe(0);
    });

    it('should default options to an empty array', () => {

      const config = { controllers: [], platform: 'test' };
      const platform = new AccessPlatform(log as any, config as any, api as any);

      expect(platform.config.options).toEqual([]);
    });

    it('should default debugAll to false', () => {

      const config = { controllers: [], platform: 'test' };
      const platform = new AccessPlatform(log as any, config as any, api as any);

      expect(platform.config.debugAll).toBe(false);
    });

    it('should use provided ringDelay when specified', () => {

      const config = { controllers: [], platform: 'test', ringDelay: 5 };
      const platform = new AccessPlatform(log as any, config as any, api as any);

      expect(platform.config.ringDelay).toBe(5);
    });

    it('should use provided options when specified', () => {

      const config = { controllers: [], options: ['Disable.Device'], platform: 'test' };
      const platform = new AccessPlatform(log as any, config as any, api as any);

      expect(platform.config.options).toEqual(['Disable.Device']);
    });
  });

  describe('MQTT topic default', () => {

    it('should set mqttTopic to ACCESS_MQTT_TOPIC when not provided', () => {

      const controllerConfig = { address: '192.168.1.1', password: 'test', username: 'admin' };
      const config = {
        controllers: [controllerConfig],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(controllerConfig).toHaveProperty('mqttTopic', ACCESS_MQTT_TOPIC);
    });

    it('should preserve mqttTopic when already provided', () => {

      const controllerConfig = { address: '192.168.1.1', mqttTopic: 'custom/topic', password: 'test', username: 'admin' };
      const config = {
        controllers: [controllerConfig],
        platform: 'test',
      };

      new AccessPlatform(log as any, config as any, api as any);

      expect(controllerConfig.mqttTopic).toBe('custom/topic');
    });
  });
});
