/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * lib-mqttclient.test.ts: Tests for the MQTT client's topic management, logging, and connection options.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import util from 'node:util';

// A stand-in for the MQTT transport, so we can observe what the client asks of it.
class FakeConnection extends EventEmitter {

  public static instances: FakeConnection[] = [];

  public end = vi.fn();
  public publish = vi.fn();
  public subscribe = vi.fn();
  public unsubscribe = vi.fn();

  constructor(public url: string, public options: Record<string, unknown>) {

    super();

    let parsed;

    // Mirror the real transport's URL validation.
    try {

      parsed = new URL(url);
    } catch {

      throw new Error('Missing protocol');
    }

    if(![ 'mqtt:', 'mqtts:' ].includes(parsed.protocol)) {

      throw new Error('Unsupported protocol: ' + parsed.protocol.replace(':', ''));
    }

    FakeConnection.instances.push(this);
  }
}

vi.mock('../src/lib/mqtt-connection.js', () => ({ MqttConnection: FakeConnection }));

const { MqttClient, redactBrokerUrl } = await import('../src/lib/mqttclient.js');

function createLog(): { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {

  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('redactBrokerUrl', () => {

  it.each([
    [ 'mqtt://user:secret@broker.local', 'mqtt://REDACTED@broker.local' ],
    [ 'mqtts://token@broker.local:8883', 'mqtts://REDACTED@broker.local:8883' ],
    [ 'mqtt://user:se/cr@et@broker.local', 'mqtt://REDACTED@broker.local' ],
    [ 'user:secret@broker.local', 'user:REDACTED@broker.local' ],
    [ 'mqtt//user:secret@broker.local', 'REDACTED@broker.local' ],
    [ 'mqtt://broker.local', 'mqtt://broker.local' ],
  ])('redacts %s', (url, expected) => {

    expect(redactBrokerUrl(url)).toBe(expected);
    expect(redactBrokerUrl(url)).not.toMatch(/secret|se\/cr/);
  });
});

describe('MqttClient', () => {

  let log: ReturnType<typeof createLog>;

  beforeEach(() => {

    FakeConnection.instances = [];
    log = createLog();
  });

  it('validates the broker certificate by default, and lets callers opt out', () => {

    new MqttClient('mqtts://broker.local', 'unifi/access', log);
    new MqttClient('mqtts://broker.local', 'unifi/access', log, 60, { verifyTls: false });

    expect(FakeConnection.instances.map(connection => connection.options.rejectUnauthorized)).toEqual([ true, false ]);
  });

  it.each([
    [ 'user:secret@broker.local', 'Only mqtt://' ],
    [ 'notaurl-secret@', 'Invalid URL provided' ],
  ])('never logs credentials for the malformed broker URL %s', (url, message) => {

    new MqttClient(url, 'unifi/access', log);

    const logged = log.error.mock.calls.map(call => util.format(...call)).join('\n');

    expect(logged).toContain(message);
    expect(logged).not.toContain('secret');
  });

  it('redacts credentials when announcing the connection', () => {

    new MqttClient('mqtt://user:secret@broker.local', 'unifi/access', log);
    FakeConnection.instances[0].emit('connect');

    expect(log.info).toHaveBeenCalledWith(expect.any(String), 'mqtt://REDACTED@broker.local', 'unifi/access');
  });

  it('explains certificate verification failures', () => {

    new MqttClient('mqtts://broker.local', 'unifi/access', log, 1);
    FakeConnection.instances[0].emit('error', Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }));

    const logged = util.format(...log.error.mock.calls[0]);

    expect(logged).toContain('Unable to verify the TLS certificate of the broker (DEPTH_ZERO_SELF_SIGNED_CERT)');
    expect(logged).toContain('Will retry again in 1 second.');
  });

  it('publishes and subscribes under the topic prefix and device id', () => {

    const client = new MqttClient('mqtt://broker.local', 'unifi/access', log);
    const connection = FakeConnection.instances[0];

    client.publish('ABC', 'lock', 'true');
    client.publish('', 'lock', 'true');

    expect(connection.publish.mock.calls).toEqual([ [ 'unifi/access/ABC/lock', 'true' ] ]);
  });

  it('answers get requests and dispatches set requests', async () => {

    const client = new MqttClient('mqtt://broker.local', 'unifi/access', log);
    const connection = FakeConnection.instances[0];
    const setValue = vi.fn();

    client.subscribeGet('ABC', 'lock', 'Lock', () => 'false');
    client.subscribeSet('ABC', 'lock', 'Lock', setValue);

    expect(connection.subscribe.mock.calls).toEqual([ [ 'unifi/access/ABC/lock/get' ], [ 'unifi/access/ABC/lock/set' ] ]);

    connection.emit('message', 'unifi/access/ABC/lock/get', Buffer.from('nope'));
    connection.emit('message', 'unifi/access/ABC/lock/get', Buffer.from('TRUE'));

    expect(connection.publish.mock.calls).toEqual([ [ 'unifi/access/ABC/lock', 'false' ] ]);

    connection.emit('message', 'unifi/access/ABC/lock/set', Buffer.from(' False'));
    await vi.waitFor(() => expect(setValue).toHaveBeenCalledWith(' false', ' False'));
  });

  it('logs rather than throws when a set handler fails', async () => {

    const client = new MqttClient('mqtt://broker.local', 'unifi/access', log);

    client.subscribeSet('ABC', 'lock', 'Lock', () => {

      throw new Error('relay offline.');
    });

    FakeConnection.instances[0].emit('message', 'unifi/access/ABC/lock/set', Buffer.from('true'));

    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith(expect.any(String), 'Lock', 'true', 'relay offline'));
  });

  it('stops routing messages once unsubscribed', () => {

    const client = new MqttClient('mqtt://broker.local', 'unifi/access', log);
    const connection = FakeConnection.instances[0];

    client.subscribeGet('ABC', 'lock', 'Lock', () => 'true');
    client.unsubscribe('ABC', 'lock/get');
    connection.emit('message', 'unifi/access/ABC/lock/get', Buffer.from('true'));

    expect(connection.unsubscribe).toHaveBeenCalledWith('unifi/access/ABC/lock/get');
    expect(connection.publish).not.toHaveBeenCalled();
  });

  it('disconnects on end', () => {

    const client = new MqttClient('mqtt://broker.local', 'unifi/access', log);

    client.end();
    client.publish('ABC', 'lock', 'true');

    expect(FakeConnection.instances[0].end).toHaveBeenCalled();
    expect(FakeConnection.instances[0].publish).not.toHaveBeenCalled();
  });
});
