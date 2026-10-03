/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-controller-flow.test.ts: Tests for the controller's connection lifecycle - login, discovery, periodic refresh, and removal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createMockDeviceConfig } from './mocks/unifi-access.js';
import { createMockPlatform } from './mocks/controller.js';

// A stand-in for the Access API client, driven by our tests.
class FakeAccessApi extends EventEmitter {

  public static instances: FakeAccessApi[] = [];
  public static loginResults: boolean[] = [];

  public bootstrap: unknown = null;
  public close = vi.fn();
  public controller = { host: { firmware_version: '4.0.0', mac: '00:11:22:33:44:55' }, version: '2.0.0' };
  public devices: ReturnType<typeof createMockDeviceConfig>[] = [];
  public getBootstrap = vi.fn(async () => {

    this.bootstrap = {};
    this.emit('bootstrap', this.bootstrap);

    return true;
  });

  public getDeviceName = vi.fn((device: { alias?: string }) => device.alias ?? 'Device');
  public getFullName = vi.fn((device: { alias?: string }) => device.alias ?? 'Device');
  public login = vi.fn(async () => FakeAccessApi.loginResults.shift() ?? true);
  public logout = vi.fn();
  public name = 'Test Controller';

  constructor(public log: unknown, public options: unknown) {

    super();
    FakeAccessApi.instances.push(this);
  }
}

// A minimal hub that records how it was configured.
class FakeHub {

  public static instances: FakeHub[] = [];

  public cleanup = vi.fn();
  public configureInfo = vi.fn();
  public hasFeature = vi.fn(() => true);

  constructor(public controller: unknown, public uda: ReturnType<typeof createMockDeviceConfig>, public accessory: unknown) {

    FakeHub.instances.push(this);
  }
}

vi.mock('../src/unifi/index.js', () => ({ AccessApi: FakeAccessApi }));
vi.mock('../src/hub/index.js', () => ({ AccessHub: FakeHub }));
vi.mock('../src/lib/mqttclient.js', () => ({ MqttClient: vi.fn(function(this: { end: () => void }) {

  this.end = vi.fn();
}) }));

const { AccessController } = await import('../src/access-controller.js');
const { MqttClient } = await import('../src/lib/mqttclient.js');

function createOptions(overrides: Record<string, unknown> = {}): never {

  return { address: '192.168.1.1', mqttTopic: 'unifi/access', password: 'test', username: 'admin', ...overrides } as never;
}

describe('AccessController lifecycle', () => {

  let platform: ReturnType<typeof createMockPlatform>;

  beforeEach(() => {

    vi.useFakeTimers();
    FakeAccessApi.instances = [];
    FakeAccessApi.loginResults = [];
    FakeHub.instances = [];
    platform = createMockPlatform();
  });

  afterEach(() => {

    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('logs in, bootstraps, and adds the devices it discovers to HomeKit', async () => {

    const controller = new AccessController(platform as never, createOptions({ verifyTls: true }));
    const login = controller.login();
    const api = FakeAccessApi.instances[0];

    api.devices = [ createMockDeviceConfig({ alias: 'Front Door' }), createMockDeviceConfig({ capabilities: ['is_camera'], mac: '11:11:11:11:11:11' }) ];
    await login;

    expect(api.options).toMatchObject({ pinnedFingerprint: undefined, verifyTls: true });
    expect(api.login).toHaveBeenCalledWith('192.168.1.1', 'admin', 'test');
    expect(platform.api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(FakeHub.instances).toHaveLength(1);
    expect(FakeHub.instances[0].uda.alias).toBe('Front Door');
    expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining('is not currently supported'));
  });

  it('pins the controller certificate through the shared pin store unless strict validation is enabled', async () => {

    platform.tlsPins.get.mockReturnValue('AA:BB');

    const login = new AccessController(platform as never, createOptions()).login();
    const options = FakeAccessApi.instances[0].options as { onFingerprint: (fingerprint: string) => void; pinnedFingerprint: string; verifyTls: boolean };

    await login;

    expect(options).toMatchObject({ pinnedFingerprint: 'AA:BB', verifyTls: false });
    expect(platform.tlsPins.get).toHaveBeenCalledWith('192.168.1.1');

    options.onFingerprint('CC:DD');
    expect(platform.tlsPins.set).toHaveBeenCalledWith('192.168.1.1', 'CC:DD');
  });

  it('keeps retrying the login until the controller is reachable', async () => {

    FakeAccessApi.loginResults = [ false, false ];

    const controller = new AccessController(platform as never, createOptions());
    const login = controller.login();
    const api = FakeAccessApi.instances[0];

    await vi.advanceTimersByTimeAsync(25 * 1000);
    await login;

    expect(api.login).toHaveBeenCalledTimes(3);
    expect(api.getBootstrap).toHaveBeenCalled();
  });

  it('refreshes the bootstrap periodically without accumulating timers', async () => {

    const controller = new AccessController(platform as never, createOptions());

    await controller.login();

    const api = FakeAccessApi.instances[0];

    // Several bootstraps in quick succession must leave a single pending refresh.
    api.emit('bootstrap', {});
    api.emit('bootstrap', {});
    api.getBootstrap.mockClear();

    await vi.advanceTimersByTimeAsync(120 * 1000);

    expect(api.getBootstrap).toHaveBeenCalledTimes(1);
  });

  it('only rewrites the accessory cache at startup and when accessories change', async () => {

    const controller = new AccessController(platform as never, createOptions());

    await controller.login();
    platform.api.updatePlatformAccessories.mockClear();

    FakeAccessApi.instances[0].emit('bootstrap', {});

    expect(platform.api.updatePlatformAccessories).not.toHaveBeenCalled();
  });

  it('connects to MQTT when a broker is configured, verifying TLS unless told otherwise', async () => {

    await new AccessController(platform as never, createOptions({ mqttUrl: 'mqtts://broker' })).login();
    await new AccessController(platform as never, createOptions({ mqttUrl: 'mqtts://broker', mqttVerifyTls: false })).login();

    expect(vi.mocked(MqttClient).mock.calls.map(call => call[4])).toEqual([ { verifyTls: true }, { verifyTls: false } ]);
  });

  it('removes its accessories when the controller is disabled', async () => {

    platform.featureOptions.test.mockImplementation((option: string, id?: string) => !((option === 'Device') && (id === '001122334455')));

    const ours = { UUID: 'ours', context: { controller: '00:11:22:33:44:55' }, getService: vi.fn() };
    const theirs = { UUID: 'theirs', context: { controller: '66:77:88:99:AA:BB' }, getService: vi.fn() };

    platform.accessories.push(ours, theirs);

    const controller = new AccessController(platform as never, createOptions());

    // The first check happens before we know the controller's identity, so let it through.
    platform.featureOptions.test.mockReturnValueOnce(true);

    const login = controller.login();

    await vi.advanceTimersByTimeAsync(30 * 1000);
    await login;

    expect(FakeAccessApi.instances[0].logout).toHaveBeenCalled();
    expect(platform.accessories).toEqual([ theirs ]);
  });

  it('closes its connections on shutdown', async () => {

    const controller = new AccessController(platform as never, createOptions());

    await controller.login();
    controller.shutdown();

    const api = FakeAccessApi.instances[0];

    api.getBootstrap.mockClear();
    await vi.advanceTimersByTimeAsync(120 * 1000);

    expect(api.close).toHaveBeenCalled();
    expect(api.getBootstrap).not.toHaveBeenCalled();
  });
});
