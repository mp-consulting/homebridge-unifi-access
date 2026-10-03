/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * lib-util.test.ts: Tests for the dependency-free utility functions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBps, retry, runWithTimeout, sanitizeName, sleep, toStartCase, validateName } from '../src/lib/util.js';

describe('formatBps', () => {

  it.each([
    [0, '0 bps'],
    [999, '999 bps'],
    [1000, '1 kbps'],
    [1500, '1.5 kbps'],
    [128000, '128 kbps'],
    [999949, '999.9 kbps'],
    [1000000, '1 Mbps'],
    [2500000, '2.5 Mbps'],
    [10000000, '10 Mbps'],
  ])('formats %d as %s', (value, expected) => {

    expect(formatBps(value)).toBe(expected);
  });

  it('rounds values just under 1 Mbps up to 1000.0 kbps rather than switching units', () => {

    expect(formatBps(999999)).toBe('1000.0 kbps');
  });
});

describe('sleep', () => {

  beforeEach(() => {

    vi.useFakeTimers();
  });

  afterEach(() => {

    vi.useRealTimers();
  });

  it('resolves only after the requested interval elapses', async () => {

    const done = vi.fn();

    void sleep(500).then(done);

    await vi.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('retry', () => {

  beforeEach(() => {

    vi.useFakeTimers();
  });

  afterEach(() => {

    vi.useRealTimers();
  });

  it('returns true immediately when the first attempt succeeds', async () => {

    const operation = vi.fn().mockResolvedValue(true);

    await expect(retry(operation, 1000)).resolves.toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries at the given interval until the operation succeeds', async () => {

    const operation = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const result = retry(operation, 1000);

    await vi.advanceTimersByTimeAsync(0);
    expect(operation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(operation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(operation).toHaveBeenCalledTimes(3);

    await expect(result).resolves.toBe(true);
  });

  it('gives up after totalRetries attempts and resolves false', async () => {

    const operation = vi.fn().mockResolvedValue(false);
    const result = retry(operation, 100, 3);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe(false);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('never calls the operation when totalRetries is zero', async () => {

    const operation = vi.fn().mockResolvedValue(true);

    await expect(retry(operation, 100, 0)).resolves.toBe(false);
    expect(operation).not.toHaveBeenCalled();
  });

  it('keeps retrying indefinitely when totalRetries is omitted', async () => {

    let calls = 0;
    const operation = vi.fn(async () => ++calls >= 50);
    const result = retry(operation, 10);

    await vi.advanceTimersByTimeAsync(10 * 50);

    await expect(result).resolves.toBe(true);
    expect(operation).toHaveBeenCalledTimes(50);
  });

  it('propagates a rejection from the operation', async () => {

    const operation = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(retry(operation, 100, 5)).rejects.toThrow('boom');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('runWithTimeout', () => {

  beforeEach(() => {

    vi.useFakeTimers();
  });

  afterEach(() => {

    vi.useRealTimers();
  });

  it('resolves with the promise value when it settles before the timeout and clears the timer', async () => {

    await expect(runWithTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves null when the timeout expires first', async () => {

    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000));
    const result = runWithTimeout(slow, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBeNull();
  });

  it('propagates a rejection that occurs before the timeout', async () => {

    await expect(runWithTimeout(Promise.reject(new Error('fail')), 1000)).rejects.toThrow('fail');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('toStartCase', () => {

  it.each([
    ['hello world', 'Hello World'],
    ['already Cased', 'Already Cased'],
    ['multiple   spaces here', 'Multiple   Spaces Here'],
    ['', ''],
    ['x', 'X'],
  ])('converts %j to %j', (input, expected) => {

    expect(toStartCase(input)).toBe(expected);
  });
});

describe('validateName', () => {

  it.each([
    'Front Door',
    'Door 1',
    'Bob\'s Gate',
    'Bob’s Gate',
    'Café',
    'AB',
    'Gate-House, Main & Side',
    'Door/Gate',
    'Entry (North): 2',
  ])('accepts %j', (name) => {

    expect(validateName(name)).toBe(true);
  });

  it.each([
    '',
    ' Front Door',
    'Front Door ',
    'Front  Door',
    '-Door',
    'Door-',
    'Door!',
    '🚪 Door',
    'A',
    'Door 2.',
    'Door #1',
    'Say "Hi"',
  ])('rejects %j', (name) => {

    expect(validateName(name)).toBe(false);
  });
});

describe('sanitizeName', () => {

  it('returns valid names unchanged', () => {

    expect(sanitizeName('Front Door')).toBe('Front Door');
  });

  it.each([
    ['Front  Door', 'Front Door'],
    ['  Front Door  ', 'Front Door'],
    ['🚪 Front Door', 'Front Door'],
    ['Door #1', 'Door 1'],
    ['Door!!', 'Door'],
    ['-#Door', 'Door'],
    ['Door...', 'Door'],
    ['Door-', 'Door'],
    ['Front\tDoor', 'Front Door'],
    ['🚪', ''],
    ['', ''],
  ])('sanitizes %j to %j', (input, expected) => {

    expect(sanitizeName(input)).toBe(expected);
  });

  it('agrees with the naming rules HAP-NodeJS enforces', async () => {

    const { checkName } = await import('@homebridge/hap-nodejs/dist/lib/util/checkName.js') as { checkName: (d: string, n: string, v: string) => void };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for(const name of [ 'Front Door', 'A', 'Door 2.', 'Door #1', 'Door/Gate', 'Bob’s Gate', 'Gate-House, Main & Side', 'Entry (North): 2', '🚪 Door' ]) {

      warn.mockClear();
      checkName(name, 'Name', name);

      expect(validateName(name), name).toBe(warn.mock.calls.length === 0);
    }

    warn.mockRestore();
  });

  it('produces names that pass validation for typical inputs', () => {

    for(const input of ['Front  Door', '🚪 Front Door', 'Door #1', '-#Door', 'Door...', 'Door-']) {

      expect(validateName(sanitizeName(input))).toBe(true);
    }
  });
});
