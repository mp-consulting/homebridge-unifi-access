import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM module of the custom UI server, no type declarations
import { ASSISTANT_PLUGIN_NAME, UNIFI_ACCESS_AI_CONTEXT, registerAssistant } from '../homebridge-ui/assistant.js';
// @ts-expect-error -- plain ESM module of the custom UI, no type declarations
import { assistantController, assistantDevice, deviceProblem, scrubText } from '../homebridge-ui/public/modules/assistant.js';

interface ChatRequest {
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
}

const usage = { inputTokens: 10, outputTokens: 5 };

/** Provider stand-in: no network, replies with `reply` (streamed in two chunks). */
function fakeProvider(reply: string) {
  const requests: ChatRequest[] = [];
  const result = (text: string) => ({
    text,
    toolCalls: [],
    usage,
    stopReason: 'end',
    model: 'fake-model',
    message: { role: 'assistant', content: text },
  });
  const provider = {
    name: 'anthropic',
    model: 'fake-model',
    capabilities: { tools: false, streaming: true, contextTokens: 100_000, jsonMode: false },
    async chat(request: ChatRequest) {
      requests.push(request);
      return result(reply);
    },
    async *stream(request: ChatRequest) {
      requests.push(request);
      const half = Math.ceil(reply.length / 2);
      yield { type: 'text', delta: reply.slice(0, half) };
      yield { type: 'text', delta: reply.slice(half) };
      yield { type: 'done', usage, stopReason: 'end', result: result(reply) };
    },
  };
  return { provider, requests };
}

function fakeServer(homebridgeConfigPath?: string) {
  const handlers = new Map<string, (body: unknown) => unknown>();
  const events: Array<[string, unknown]> = [];
  const server = {
    homebridgeConfigPath,
    onRequest: (path: string, fn: (body: unknown) => unknown) => handlers.set(path, fn),
    pushEvent: (event: string, data: unknown) => events.push([event, data]),
  };
  const call = (path: string, body: unknown = {}) => Promise.resolve(handlers.get(path)!(body));
  return { server, handlers, events, call };
}

async function writeConfig(platforms: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'unifi-access-assistant-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ bridge: { name: 'Homebridge' }, platforms }));
  return path;
}

describe('homebridge-ui Assistant routes', () => {
  it('registers the four Assistant routes', () => {
    const ui = fakeServer();
    registerAssistant(ui.server, { loadConfig: async () => null });
    expect([...ui.handlers.keys()].sort()).toEqual(['/ai/ask', '/ai/config', '/ai/explain', '/ai/status']);
  });

  it('reports the Assistant as off when the AI Kit block is missing', async () => {
    const ui = fakeServer(await writeConfig([{ platform: 'UniFi Access', controllers: [{ address: '192.168.1.1', username: 'u', password: 'p' }] }]));
    registerAssistant(ui.server);
    expect(await ui.call('/ai/status')).toEqual({ enabled: false, provider: null, model: null, capabilities: null });
    await expect(ui.call('/ai/explain', { error: 'x' })).rejects.toThrow('The Assistant is not set up');
  });

  it('reads the shared HomebridgeAiKit block and never returns its key', async () => {
    const ui = fakeServer(await writeConfig([
      { platform: 'UniFi Access', controllers: [] },
      { platform: 'HomebridgeAiKit', provider: 'anthropic', apiKey: 'sk-ant-secret-key' },
    ]));
    registerAssistant(ui.server);
    const status = await ui.call('/ai/status');
    expect(status).toMatchObject({ enabled: true, provider: 'anthropic' });
    expect(JSON.stringify(status)).not.toContain('sk-ant-secret-key');
  });

  it('explains a device error with the UniFi Access context and streams it', async () => {
    const { provider, requests } = fakeProvider('Check the Wi-Fi.');
    const ui = fakeServer();
    registerAssistant(ui.server, {
      loadConfig: async () => ({ enabled: true, provider: 'anthropic', model: 'fake-model' }),
      createProvider: () => provider,
    });

    const result = await ui.call('/ai/explain', {
      error: 'UniFi Access reports this device as disconnected.',
      context: 'The user is looking at the feature options of a UniFi Access device in the plugin webUI.',
      device: { name: 'Front Door Hub', model: 'UA-Hub', online: false },
      requestId: 'r1',
    });

    expect(result).toEqual({ text: 'Check the Wi-Fi.', usage });
    expect(ui.events).toEqual([
      ['ai:chunk', { requestId: 'r1', delta: 'Check th' }],
      ['ai:chunk', { requestId: 'r1', delta: 'e Wi-Fi.' }],
      ['ai:done', { requestId: 'r1' }],
    ]);
    expect(requests[0].system).toContain(ASSISTANT_PLUGIN_NAME);
    expect(requests[0].system).toContain(UNIFI_ACCESS_AI_CONTEXT);
    expect(JSON.stringify(requests[0].messages)).toContain('Front Door Hub');
  });

  it('describes logins, error messages, TLS pinning and discovery in its context', () => {
    expect(ASSISTANT_PLUGIN_NAME).toBe('@mp-consulting/homebridge-unifi-access');
    for (const fact of ['local user', '401', '403', 'Invalid login credentials given', 'Insufficient privileges', 'ECONNREFUSED', 'ENOTFOUND',
      'unifi-access-tls-pins.json', 'verifyTls', '10001']) {
      expect(UNIFI_ACCESS_AI_CONTEXT).toContain(fact);
    }
  });
});

describe('homebridge-ui Assistant data guards', () => {
  const device = {
    alias: 'Front Door',
    capabilities: ['is_hub', 'door_bell'],
    display_model: 'UA Hub',
    firmware: 'v1.2.3',
    guid: 'guid-secret',
    ip: '10.0.0.42',
    is_adopted: true,
    is_connected: false,
    is_online: false,
    is_rebooting: false,
    location_id: 'loc-secret',
    mac: 'aa:bb:cc:dd:ee:ff',
    model: 'UA-Hub',
    name: 'Front Door Hub',
    unique_id: 'uid-secret',
  };

  it('scrubs the controller address, IP and MAC addresses from error text', () => {
    const text = 'unifi.local: API error: Hostname or IP address not found: unifi.local (10.0.0.1, aa:bb:cc:dd:ee:ff, AA-BB-CC-DD-EE-FF).';
    expect(scrubText(text, ['unifi.local', '', undefined])).toBe(
      '[address]: API error: Hostname or IP address not found: [address] ([IP address], [MAC address], [MAC address]).');
    expect(scrubText(undefined)).toBe('');
  });

  it('shares only whitelisted device facts', () => {
    const shared = assistantDevice(device);
    expect(shared).toEqual({
      adopted: true,
      capabilities: ['is_hub', 'door_bell'],
      connected: false,
      displayModel: 'UA Hub',
      firmware: 'v1.2.3',
      model: 'UA-Hub',
      name: 'Front Door Hub',
      online: false,
      rebooting: false,
    });
    const json = JSON.stringify(shared);
    for (const secret of ['10.0.0.42', 'aa:bb', 'guid-secret', 'loc-secret', 'uid-secret']) {
      expect(json).not.toContain(secret);
    }
  });

  it('never shares controller credentials, addresses or the MQTT broker URL', () => {
    const shared = assistantController({
      address: '10.0.0.1', mqttUrl: 'mqtt://user:pw@broker:1883', name: 'Home', password: 'hunter2', username: 'admin', verifyTls: true,
    });
    expect(shared).toEqual({ mqttConfigured: true, mqttVerifyTls: true, name: 'Home', verifyTls: true });
    expect(JSON.stringify(shared)).not.toMatch(/10\.0\.0\.1|hunter2|admin|broker/);
  });

  it('reports disconnected and rebooting devices, never the controller itself', () => {
    expect(deviceProblem(device)).toContain('disconnected');
    expect(deviceProblem({ ...device, is_rebooting: true })).toContain('rebooting');
    expect(deviceProblem({ ...device, is_online: true })).toBeNull();
    expect(deviceProblem({ display_model: 'controller', is_online: false })).toBeNull();
    expect(deviceProblem(undefined)).toBeNull();
  });
});
