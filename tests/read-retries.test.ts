import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SolRouter } from '../src/client.js';
import * as encryption from '../src/encryption.js';
import { TEST_API_KEY, TEST_BASE_URL, mockBalanceResponse, mockEncryptedData } from './fixtures/index.js';

vi.mock('../src/encryption.js', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  packageForTEE: vi.fn(),
  clearSession: vi.fn(),
}));

const mockFetch = vi.fn();

function balanceResponse(): Response {
  return new Response(JSON.stringify(mockBalanceResponse));
}

describe('safe read retries', () => {
  let client: SolRouter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    client = new SolRouter({ apiKey: TEST_API_KEY, baseUrl: TEST_BASE_URL });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [429, '2', 2000, true],
    [503, '2', 2000, true],
    [502, '30', 30000, true],
    [503, '31', 0, false],
    [429, '9'.repeat(400), 0, false],
  ])('honors bounded Retry-After seconds: %s / %s', async (status, retryAfter, wait, retry) => {
    mockFetch
      .mockResolvedValueOnce(new Response('Try later', {
        status,
        headers: { 'Retry-After': retryAfter },
      }))
      .mockResolvedValueOnce(balanceResponse());

    const result = client.getBalance().catch(error => error);
    if (retry) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toHaveProperty('balance', mockBalanceResponse.balance_usdc);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } else {
      // Do not shorten a server's cooldown to our cap and retry too early.
      await vi.runAllTimersAsync();
      expect(await result).toEqual(new Error('Failed to fetch balance'));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([2000, 30000, 31000, -5000])(
    'honors Retry-After HTTP-dates with a %i ms offset',
    async offset => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      mockFetch
        .mockResolvedValueOnce(new Response('Try later', {
          status: 503,
          headers: { 'Retry-After': new Date(Date.now() + offset).toUTCString() },
        }))
        .mockResolvedValueOnce(balanceResponse());
      const result = client.getBalance().catch(error => error);
      if (offset > 30000) {
        await vi.runAllTimersAsync();
        expect(await result).toEqual(new Error('Failed to fetch balance'));
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } else {
        await vi.advanceTimersByTimeAsync(Math.max(250, offset) - 1);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toHaveProperty('balance', mockBalanceResponse.balance_usdc);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      }
    },
  );

  describe.each([
    ['Asia/Kolkata', -330],
    ['America/New_York', 300],
  ] as const)('Retry-After HTTP-dates in %s', (timezone, utcOffset) => {
    beforeEach(() => {
      vi.stubEnv('TZ', timezone);
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      ['Thu Jan  1 00:00:02 2026', 2000],
      ['Thu Jan  1 00:00:30 2026', 30000],
      ['Thu Jan  1 00:00:31 2026', null],
      ['Wed Dec 31 23:59:55 2025', 250],
      ['Thu Jan  1 00:00:99 2026', 250],
      ['Thu, 01 Jan 2026 00:00:02 GMT', 2000],
      ['Thursday, 01-Jan-26 00:00:02 GMT', 2000],
    ] as const)('honors the GMT cooldown for %s', async (retryAfter, wait) => {
      // Ensure these regressions really run outside UTC, even on UTC CI hosts.
      expect(new Date().getTimezoneOffset()).toBe(utcOffset);
      const failure = new Response('Try later', {
        status: 503,
        headers: { 'Retry-After': retryAfter },
      });
      const cancel = vi.spyOn(failure.body!, 'cancel');
      mockFetch.mockResolvedValueOnce(failure).mockResolvedValueOnce(balanceResponse());
      const result = client.getBalance().catch(error => error);
      if (wait === null) {
        await vi.runAllTimersAsync();
        expect(await result).toEqual(new Error('Failed to fetch balance'));
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(cancel).not.toHaveBeenCalled();
      } else {
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toHaveProperty('balance', mockBalanceResponse.balance_usdc);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledTimes(1);
      }
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it.each([null, '', '0', '-1', '1.5', '9999.5', 'Infinity', 'NaN', 'nonsense', 'Sun, invalid GMT'])(
    'uses backoff for missing, zero or malformed Retry-After: %s',
    async retryAfter => {
      mockFetch
        .mockResolvedValueOnce(new Response('Try later', {
          status: 429,
          headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
        }))
        .mockResolvedValueOnce(balanceResponse());
      const result = client.getBalance().catch(error => error);
      await vi.advanceTimersByTimeAsync(249);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toHaveProperty('balance', mockBalanceResponse.balance_usdc);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each([0, 0.5, 0.999])('jitters backoff (%s) but stops after three total attempts', async random => {
    vi.mocked(Math.random).mockReturnValue(random);
    mockFetch.mockImplementation(() => Promise.resolve(new Response('Unavailable', { status: 503 })));
    const result = client.getBalance().catch(error => error);
    for (let attempt = 0; attempt < 2; attempt++) {
      const delay = Math.floor(250 * 2 ** attempt * (1 + random));
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(mockFetch).toHaveBeenCalledTimes(attempt + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockFetch).toHaveBeenCalledTimes(attempt + 2);
    }
    expect(await result).toEqual(new Error('Failed to fetch balance'));
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('cancels a discarded response body before retry (cancel rejects: %s)', async rejects => {
    const failure = new Response('<html>Unavailable</html>', { status: 503 });
    const cancel = vi.spyOn(failure.body!, 'cancel');
    if (rejects) cancel.mockRejectedValueOnce(new Error('Already aborted'));
    mockFetch.mockResolvedValueOnce(failure).mockResolvedValueOnce(balanceResponse());
    const result = client.getBalance().catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(await result).toHaveProperty('balance', mockBalanceResponse.balance_usdc);
  });

  it.each([429, 502, 503])('can disable automatic read retries for HTTP %s', async status => {
    const failFast = new SolRouter({ apiKey: TEST_API_KEY, retryReads: false });
    mockFetch
      .mockResolvedValueOnce(new Response('Try later', { status, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(balanceResponse());
    const result = failFast.getBalance().catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error('Failed to fetch balance'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe.each(['list', 'get'] as const)('skills.%s', method => {
    it.each([429, 502, 503])('retries the safe skill read after HTTP %s', async status => {
      const skill = { id: 'example/name' };
      mockFetch
        .mockResolvedValueOnce(new Response('Unavailable', { status }))
        .mockResolvedValueOnce(new Response(JSON.stringify(method === 'list' ? { skills: [skill] } : skill)));
      const result = (method === 'list' ? client.skills.list() : client.skills.get(skill.id)).catch(error => error);
      await vi.advanceTimersByTimeAsync(249);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual(method === 'list' ? [skill] : skill);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const url = `${TEST_BASE_URL}/skills${method === 'get' ? '/example%2Fname' : ''}`;
      expect(mockFetch.mock.calls).toEqual([[url], [url]]);
    });

    it('respects the read retry opt-out', async () => {
      const failFast = new SolRouter({ apiKey: TEST_API_KEY, retryReads: false });
      mockFetch.mockResolvedValue(new Response('Unavailable', { status: 503 }));
      const result = (method === 'list' ? failFast.skills.list() : failFast.skills.get('example')).catch(error => error);
      await vi.runAllTimersAsync();
      expect(await result).toEqual(new Error(`skills.${method} failed: 503`));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  it.each([400, 401, 402, 403, 404, 408, 500, 504])('does not retry other HTTP errors (%s)', async status => {
    mockFetch.mockResolvedValueOnce(new Response('Failure', { status, headers: { 'Retry-After': '1' } }));
    const result = client.getBalance().catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error('Failed to fetch balance'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([new TypeError('Network failure'), new DOMException('Aborted', 'AbortError')])(
    'propagates fetch failures unchanged without retry: %s',
    async error => {
      mockFetch.mockRejectedValueOnce(error);
      const result = client.getBalance().catch(error => error);
      await vi.runAllTimersAsync();
      expect(await result).toBe(error);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry a successful HTTP response with invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce(new Response('invalid JSON'));
    const result = client.getBalance().catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(SyntaxError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('stops immediately on a terminal response after a transient error', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    const result = client.skills.get('missing').catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error('skill not found: missing'));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh retry budget for each read without caching balances', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('Unavailable', { status: 502 }))
      .mockResolvedValueOnce(balanceResponse())
      .mockResolvedValueOnce(new Response('Unavailable', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance_usdc: 1, balance_formatted: '$1.0000 USDC' })));
    const first = client.getBalance().catch(error => error);
    await vi.advanceTimersByTimeAsync(250);
    expect(await first).toHaveProperty('balance', mockBalanceResponse.balance_usdc);
    const second = client.getBalance().catch(error => error);
    await vi.advanceTimersByTimeAsync(250);
    expect(await second).toEqual({ balance: 1, balanceFormatted: '$1.0000 USDC' });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('bounds repeated Retry-After waits and leaves the final response body untouched', async () => {
    const failures = Array.from({ length: 3 }, () => new Response('Try later', {
      status: 429, headers: { 'Retry-After': '30' },
    }));
    const finalCancel = vi.spyOn(failures[2].body!, 'cancel');
    failures.forEach(response => mockFetch.mockResolvedValueOnce(response));
    const started = Date.now();
    const result = client.getBalance().catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error('Failed to fetch balance'));
    expect(Date.now() - started).toBe(60_000);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(finalCancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  const postCases: [string, string, (client: SolRouter) => Promise<unknown>][] = [
    ['plain inference', '/nosana', c => c.chat('test', { encrypted: false })],
    ['routed inference', '/router', c => c.chat('test', { encrypted: false, model: 'custom' as any })],
    ['encrypted inference', '/tee/process', c => c.chat('test')],
    ['BRAID inference', '/agent', c => c.chat('test', { reasoning: 'braid', encrypted: false })],
    ['skill matching', '/skills/match', c => c.skills.match('test')],
  ];

  describe.each(postCases)('%s POST safety', (_name, endpoint, invoke) => {
    beforeEach(() => {
      vi.mocked(encryption.encrypt).mockResolvedValue(mockEncryptedData);
      vi.mocked(encryption.packageForTEE).mockReturnValue('{"ciphertext":"test"}');
    });

    it.each([429, 502, 503])('never replays HTTP %s, even with Retry-After', async status => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Do not retry' }), {
        status, headers: { 'Retry-After': '1' },
      }));
      const result = invoke(client).catch(error => error);
      await vi.runAllTimersAsync();
      expect(await result).toEqual(new Error(endpoint === '/skills/match'
        ? `skills.match failed: ${status}` : 'SolRouter API error: Do not retry'));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(`${TEST_BASE_URL}${endpoint}`, expect.objectContaining({ method: 'POST' }));
      expect(vi.getTimerCount()).toBe(0);
    });

    it('never replays a rejected fetch', async () => {
      const failure = new TypeError('Connection lost; outcome unknown');
      mockFetch.mockRejectedValueOnce(failure);
      const result = invoke(client).catch(error => error);
      await vi.runAllTimersAsync();
      expect(await result).toBe(failure);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('recovers from 502 and 503 with exponential backoff', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(balanceResponse());

    // Handle rejection immediately so a regression cannot leak an unhandled rejection.
    const result = client.getBalance().catch(error => error);
    await vi.advanceTimersByTimeAsync(249);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(await result).toEqual({
      balance: mockBalanceResponse.balance_usdc,
      balanceFormatted: mockBalanceResponse.balance_formatted,
    });
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe(`${TEST_BASE_URL}/api/v1/balance`);
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.body).toBeUndefined();
      expect(init.headers).toEqual({ Authorization: `Bearer ${TEST_API_KEY}` });
    }
  });
});
