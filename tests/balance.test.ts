/**
 * SolRouter Balance API Tests
 *
 * Tests for getBalance functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SolRouter } from '../src/client.js';
import {
  mockBalanceResponse,
  mockUnauthorizedResponse,
  TEST_API_KEY,
  TEST_BASE_URL,
} from './fixtures/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock encryption module (not used in balance tests but required by client)
vi.mock('../src/encryption.js', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  packageForTEE: vi.fn(),
  clearSession: vi.fn(),
  fetchTeePublicKey: vi.fn(),
}));

describe('Balance API', () => {
  let client: SolRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SolRouter({
      apiKey: TEST_API_KEY,
      baseUrl: TEST_BASE_URL,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getBalance()', () => {
    it('calls /api/v1/balance endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBalanceResponse),
      });

      await client.getBalance();

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/api/v1/balance`,
        expect.any(Object)
      );
    });

    it('sends Authorization header with Bearer token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBalanceResponse),
      });

      await client.getBalance();

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers).toMatchObject({
        Authorization: `Bearer ${TEST_API_KEY}`,
      });
    });

    it('uses GET method (no body)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBalanceResponse),
      });

      await client.getBalance();

      const callArgs = mockFetch.mock.calls[0];
      // GET requests should not have a method specified (defaults to GET) or explicitly be GET
      expect(callArgs[1].method).toBeUndefined();
      expect(callArgs[1].body).toBeUndefined();
    });

    it('returns balance as number', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBalanceResponse),
      });

      const result = await client.getBalance();

      expect(typeof result.balance).toBe('number');
      expect(result.balance).toBe(mockBalanceResponse.balance_usdc);
    });

    it('returns balanceFormatted as string with $ prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBalanceResponse),
      });

      const result = await client.getBalance();

      expect(typeof result.balanceFormatted).toBe('string');
      expect(result.balanceFormatted).toMatch(/^\$/);
    });

    it('formats balance to 4 decimal places', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balance_usdc: 10.5432, balance_formatted: '$10.5432 USDC' }),
      });

      const result = await client.getBalance();

      expect(result.balanceFormatted).toBe('$10.5432 USDC');
    });

    it('handles zero balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balance_usdc: 0, balance_formatted: '$0.0000 USDC' }),
      });

      const result = await client.getBalance();

      expect(result.balance).toBe(0);
      expect(result.balanceFormatted).toBe('$0.0000 USDC');
    });

    it('handles small balance values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balance_usdc: 0.0001, balance_formatted: '$0.0001 USDC' }),
      });

      const result = await client.getBalance();

      expect(result.balance).toBe(0.0001);
      expect(result.balanceFormatted).toBe('$0.0001 USDC');
    });

    it('handles large balance values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balance_usdc: 99999.9999, balance_formatted: '$99999.9999 USDC' }),
      });

      const result = await client.getBalance();

      expect(result.balance).toBe(99999.9999);
      expect(result.balanceFormatted).toBe('$99999.9999 USDC');
    });

    describe('Error Handling', () => {
      it('throws error on unauthorized response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        });

        await expect(client.getBalance()).rejects.toThrow('Failed to fetch balance');
      });

      it('throws error on server error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        await expect(client.getBalance()).rejects.toThrow('Failed to fetch balance');
      });

      it('throws error on network failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(client.getBalance()).rejects.toThrow('Network error');
      });

      it('throws error on invalid API key', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        });

        await expect(client.getBalance()).rejects.toThrow('Failed to fetch balance');
      });
    });
  });

  describe('BalanceResponse type', () => {
    it('matches expected interface', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBalanceResponse),
      });

      const result = await client.getBalance();

      // Type check - these properties should exist
      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('balanceFormatted');

      // Only these two properties
      expect(Object.keys(result)).toHaveLength(2);
    });
  });
});
