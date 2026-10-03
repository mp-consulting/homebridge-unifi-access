/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-api-tls.test.ts: Tests for trust-on-first-use TLS certificate pinning, against a real local TLS server.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { ACCESS_TLS_PIN_MISMATCH, AccessTlsPin, AccessTlsPinStore, createAccessAgent, normalizeFingerprint } from '../src/unifi/index.js';
import type { AddressInfo } from 'node:net';
import { X509Certificate } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import os from 'node:os';
import { request } from '../src/lib/request.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const cert = readFileSync(join(fixtures, 'tls-cert.pem'));
const key = readFileSync(join(fixtures, 'tls-key.pem'));
const FINGERPRINT = new X509Certificate(cert).fingerprint256;
const OTHER_FINGERPRINT = Array(32).fill('AB').join(':');

function createLog(): { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {

  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe('normalizeFingerprint', () => {

  it('normalizes common notations and rejects anything that is not SHA-256', () => {

    expect(normalizeFingerprint(FINGERPRINT.replace(/:/g, '').toLowerCase())).toBe(FINGERPRINT);
    expect(normalizeFingerprint('AB:CD')).toBeUndefined();
    expect(normalizeFingerprint(undefined)).toBeUndefined();
  });
});

describe('pinned HTTPS agent', () => {

  let server: https.Server;
  let url: string;
  let requests = 0;
  const agents: https.Agent[] = [];

  beforeAll(async () => {

    server = https.createServer({ cert, key }, (_req, res) => {

      requests++;
      res.end('ok');
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = 'https://127.0.0.1:' + (server.address() as AddressInfo).port.toString() + '/';
  });

  afterAll(async () => {

    await new Promise(resolve => server.close(resolve));
  });

  afterEach(() => {

    agents.splice(0).forEach(agent => agent.destroy());
    requests = 0;
  });

  function agentFor(pin: AccessTlsPin, verifyTls = false): https.Agent {

    const agent = createAccessAgent(verifyTls, pin, { keepAlive: false });

    agents.push(agent);

    return agent;
  }

  it('trusts and pins the first certificate it sees', async () => {

    const onFingerprint = vi.fn();
    const pin = new AccessTlsPin(createLog(), { onFingerprint });

    const response = await request(url, { agent: agentFor(pin) });

    expect(await response.body.text()).toBe('ok');
    expect(onFingerprint).toHaveBeenCalledWith(FINGERPRINT);
    expect(pin.fingerprint).toBe(FINGERPRINT);
  });

  it('connects when the certificate matches the pin', async () => {

    const onFingerprint = vi.fn();
    const pin = new AccessTlsPin(createLog(), { onFingerprint, pinnedFingerprint: FINGERPRINT.toLowerCase() });

    expect((await request(url, { agent: agentFor(pin) })).statusCode).toBe(200);
    expect(onFingerprint).not.toHaveBeenCalled();
  });

  it('refuses a mismatched certificate before sending anything, and reports it once', async () => {

    const log = createLog();
    const onFingerprintMismatch = vi.fn();
    const pin = new AccessTlsPin(log, { onFingerprintMismatch, pinnedFingerprint: OTHER_FINGERPRINT });
    const agent = agentFor(pin);

    await expect(request(url, { agent, body: '{"password":"secret"}', method: 'POST' })).rejects.toMatchObject({ code: ACCESS_TLS_PIN_MISMATCH });
    await expect(request(url, { agent })).rejects.toMatchObject({ code: ACCESS_TLS_PIN_MISMATCH });

    expect(requests).toBe(0);
    expect(onFingerprintMismatch).toHaveBeenCalledTimes(1);
    expect(onFingerprintMismatch).toHaveBeenCalledWith(OTHER_FINGERPRINT, FINGERPRINT);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('uses strict certificate validation instead of pinning when verifyTls is enabled', async () => {

    const pin = new AccessTlsPin(createLog());

    await expect(request(url, { agent: agentFor(pin, true) })).rejects.toThrow(/self[- ]signed/i);
    expect(pin.fingerprint).toBeUndefined();
  });
});

describe('AccessTlsPinStore', () => {

  let dir: string;

  beforeAll(() => {

    dir = mkdtempSync(join(os.tmpdir(), 'access-pins-'));
  });

  afterAll(() => {

    rmSync(dir, { force: true, recursive: true });
  });

  it('persists pins privately, keyed by normalized address', () => {

    const file = join(dir, 'pins.json');

    new AccessTlsPinStore(file).set(' Controller.Local ', FINGERPRINT.replace(/:/g, ''));

    expect(new AccessTlsPinStore(file).get('controller.local')).toBe(FINGERPRINT);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('does not clobber pins written by another process', () => {

    const file = join(dir, 'shared.json');
    const plugin = new AccessTlsPinStore(file);
    const webUI = new AccessTlsPinStore(file);

    expect(plugin.get('a')).toBeUndefined();
    webUI.set('b', OTHER_FINGERPRINT);
    plugin.set('a', FINGERPRINT);

    expect(new AccessTlsPinStore(file).get('b')).toBe(OTHER_FINGERPRINT);
  });

  it('ignores invalid entries and reports unreadable files', () => {

    const file = join(dir, 'bad.json');
    const onError = vi.fn();

    writeFileSync(file, JSON.stringify({ good: FINGERPRINT, nope: 'xyz' }));
    expect(new AccessTlsPinStore(file).get('good')).toBe(FINGERPRINT);
    expect(new AccessTlsPinStore(file).get('nope')).toBeUndefined();

    writeFileSync(file, '{ not json');
    expect(new AccessTlsPinStore(file, onError).get('good')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Unable to parse'));

    expect(new AccessTlsPinStore(join(dir, 'missing.json'), onError).get('x')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
