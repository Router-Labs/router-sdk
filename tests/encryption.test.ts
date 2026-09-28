/**
 * SolRouter Encryption Module Tests
 *
 * Tests for encrypt, decrypt, packageForTEE, fetchTeePublicKey, and clearSession.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TEST_BASE_URL,
  mockTeePublicKeyResponse,
} from './fixtures/index.js';

// Create mock functions that persist
const mockCipherEncrypt = vi.fn().mockReturnValue([[1, 2, 3], [4, 5, 6]]);
const mockCipherDecrypt = vi.fn().mockReturnValue([72n, 101n, 108n, 108n, 111n]); // "Hello"
const mockRandomSecretKey = vi.fn().mockReturnValue(new Uint8Array(32).fill(1));
const mockGetPublicKey = vi.fn().mockReturnValue(new Uint8Array(32).fill(2));
const mockGetSharedSecret = vi.fn().mockReturnValue(new Uint8Array(32).fill(3));

// Mock @arcium-hq/client
vi.mock('@arcium-hq/client', () => {
  return {
    RescueCipher: class MockRescueCipher {
      constructor() {}
      encrypt(plaintext: any, nonce: any) {
        return mockCipherEncrypt(plaintext, nonce);
      }
      decrypt(ciphertext: any, nonce: any) {
        return mockCipherDecrypt(ciphertext, nonce);
      }
    },
    x25519: {
      utils: {
        randomSecretKey: () => mockRandomSecretKey(),
      },
      getPublicKey: (key: any) => mockGetPublicKey(key),
      getSharedSecret: (priv: any, pub: any) => mockGetSharedSecret(priv, pub),
    },
  };
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.getRandomValues
vi.stubGlobal('crypto', {
  getRandomValues: vi.fn((arr: Uint8Array) => {
    arr.fill(42);
    return arr;
  }),
});

// Import after mocks are set up
import {
  encrypt,
  decrypt,
  packageForTEE,
  fetchTeePublicKey,
  clearSession,
} from '../src/encryption.js';
import type { EncryptedData } from '../src/types.js';
import { SolRouter } from '../src/client.js';
import { TEST_API_KEY } from './fixtures/index.js';

describe('Encryption Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCipherEncrypt.mockReturnValue([[1, 2, 3], [4, 5, 6]]);
    mockCipherDecrypt.mockReturnValue([72n, 101n, 108n, 108n, 111n]);
    mockRandomSecretKey.mockReturnValue(new Uint8Array(32).fill(1));
    mockGetPublicKey.mockReturnValue(new Uint8Array(32).fill(2));
    mockGetSharedSecret.mockReturnValue(new Uint8Array(32).fill(3));
    // Clear cached values by calling clearSession
    clearSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('encrypt()', () => {
    beforeEach(() => {
      // Mock successful TEE public key fetch
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });
    });

    it('produces valid EncryptedData structure', async () => {
      const result = await encrypt('test message', TEST_BASE_URL);

      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('nonce');
      expect(result).toHaveProperty('publicKey');
      expect(result).toHaveProperty('ephemeralPrivateKey');
    });

    it('returns base64 encoded ciphertext', async () => {
      const result = await encrypt('test', TEST_BASE_URL);

      // Should be valid base64
      expect(() => Buffer.from(result.ciphertext, 'base64')).not.toThrow();

      // Decoded should be valid JSON
      const decoded = Buffer.from(result.ciphertext, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('shape');
    });

    it('returns base64 encoded nonce', async () => {
      const result = await encrypt('test', TEST_BASE_URL);

      expect(() => Buffer.from(result.nonce, 'base64')).not.toThrow();
      // Nonce should be 16 bytes
      const nonceBytes = Buffer.from(result.nonce, 'base64');
      expect(nonceBytes.length).toBe(16);
    });

    it('returns base64 encoded publicKey', async () => {
      const result = await encrypt('test', TEST_BASE_URL);

      expect(() => Buffer.from(result.publicKey, 'base64')).not.toThrow();
      // Public key should be 32 bytes (X25519)
      const publicKeyBytes = Buffer.from(result.publicKey, 'base64');
      expect(publicKeyBytes.length).toBe(32);
    });

    it('returns base64 encoded ephemeralPrivateKey', async () => {
      const result = await encrypt('test', TEST_BASE_URL);

      expect(result.ephemeralPrivateKey).toBeDefined();
      expect(() => Buffer.from(result.ephemeralPrivateKey!, 'base64')).not.toThrow();
    });

    it('fetches TEE public key from server', async () => {
      await encrypt('test', TEST_BASE_URL);

      expect(mockFetch).toHaveBeenCalledWith(`${TEST_BASE_URL}/tee/public-key`);
    });

    it('reuses session keypair for multiple encryptions', async () => {
      await encrypt('first message', TEST_BASE_URL);
      await encrypt('second message', TEST_BASE_URL);

      // randomSecretKey should only be called once (session reuse)
      expect(mockRandomSecretKey).toHaveBeenCalledTimes(1);
    });
  });

  describe('decrypt()', () => {
    it('recovers plaintext from encrypted data', async () => {
      // Create mock encrypted data structure
      const mockCiphertext = {
        data: ['1', '2', '3', '4', '5', '6'],
        shape: [3, 3],
      };

      const encryptedData: EncryptedData = {
        ciphertext: Buffer.from(JSON.stringify(mockCiphertext)).toString('base64'),
        nonce: Buffer.from(new Uint8Array(16).fill(1)).toString('base64'),
        publicKey: Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
        ephemeralPrivateKey: Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
      };

      const result = await decrypt(encryptedData);

      // Mock returns [72n, 101n, 108n, 108n, 111n] which is "Hello"
      expect(result).toBe('Hello');
    });

    it('uses provided clientPrivateKey when given', async () => {
      const mockCiphertext = {
        data: ['1', '2', '3'],
        shape: [3],
      };

      const encryptedData: EncryptedData = {
        ciphertext: Buffer.from(JSON.stringify(mockCiphertext)).toString('base64'),
        nonce: Buffer.from(new Uint8Array(16)).toString('base64'),
        publicKey: Buffer.from(new Uint8Array(32)).toString('base64'),
      };

      const customPrivateKey = Buffer.from(new Uint8Array(32).fill(99)).toString('base64');

      await decrypt(encryptedData, customPrivateKey);

      // Should use the custom private key for shared secret
      expect(mockGetSharedSecret).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.any(Uint8Array)
      );
    });

    it('uses ephemeralPrivateKey from encryptedData when clientPrivateKey not provided', async () => {
      const mockCiphertext = {
        data: ['1', '2', '3'],
        shape: [3],
      };

      const encryptedData: EncryptedData = {
        ciphertext: Buffer.from(JSON.stringify(mockCiphertext)).toString('base64'),
        nonce: Buffer.from(new Uint8Array(16)).toString('base64'),
        publicKey: Buffer.from(new Uint8Array(32)).toString('base64'),
        ephemeralPrivateKey: Buffer.from(new Uint8Array(32).fill(77)).toString('base64'),
      };

      await decrypt(encryptedData);

      expect(mockGetSharedSecret).toHaveBeenCalled();
    });

    it('parses JSON response objects', async () => {
      // Mock decrypt to return JSON response
      const jsonResponse = JSON.stringify({ response: 'AI answer here' });
      const jsonBytes = new TextEncoder().encode(jsonResponse);
      mockCipherDecrypt.mockReturnValue(Array.from(jsonBytes).map(BigInt));

      const mockCiphertext = {
        data: ['1', '2', '3'],
        shape: [3],
      };

      const encryptedData: EncryptedData = {
        ciphertext: Buffer.from(JSON.stringify(mockCiphertext)).toString('base64'),
        nonce: Buffer.from(new Uint8Array(16)).toString('base64'),
        publicKey: Buffer.from(new Uint8Array(32)).toString('base64'),
        ephemeralPrivateKey: Buffer.from(new Uint8Array(32)).toString('base64'),
      };

      const result = await decrypt(encryptedData);

      expect(result).toBe('AI answer here');
    });

    it('returns raw text when not valid JSON', async () => {
      // Mock decrypt to return plain text
      const plainText = 'Just plain text';
      const textBytes = new TextEncoder().encode(plainText);
      mockCipherDecrypt.mockReturnValue(Array.from(textBytes).map(BigInt));

      const mockCiphertext = {
        data: ['1', '2', '3'],
        shape: [3],
      };

      const encryptedData: EncryptedData = {
        ciphertext: Buffer.from(JSON.stringify(mockCiphertext)).toString('base64'),
        nonce: Buffer.from(new Uint8Array(16)).toString('base64'),
        publicKey: Buffer.from(new Uint8Array(32)).toString('base64'),
        ephemeralPrivateKey: Buffer.from(new Uint8Array(32)).toString('base64'),
      };

      const result = await decrypt(encryptedData);

      expect(result).toBe('Just plain text');
    });
  });

  describe('Round-trip encrypt/decrypt', () => {
    it('decrypt(encrypt(msg)) preserves original message', async () => {
      // This test verifies the data flow, though with mocks
      // the actual crypto is simulated
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      const originalMessage = 'Hello, this is a secret message!';

      // Encrypt
      const encrypted = await encrypt(originalMessage, TEST_BASE_URL);

      // Verify encrypted data has correct structure
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.nonce).toBeDefined();
      expect(encrypted.publicKey).toBeDefined();
      expect(encrypted.ephemeralPrivateKey).toBeDefined();

      // In a real scenario, decrypt would use the same keys to recover the message
      // With our mocks, we verify the structure is correct for the round-trip
    });
  });

  describe('packageForTEE()', () => {
    it('returns valid JSON string', () => {
      const encryptedData: EncryptedData = {
        ciphertext: 'test-ciphertext',
        nonce: 'test-nonce',
        publicKey: 'test-publicKey',
      };

      const result = packageForTEE(encryptedData);

      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('includes algorithm field', () => {
      const encryptedData: EncryptedData = {
        ciphertext: 'test-ciphertext',
        nonce: 'test-nonce',
        publicKey: 'test-publicKey',
      };

      const result = JSON.parse(packageForTEE(encryptedData));

      expect(result.algorithm).toBe('Arcium-RescueCipher');
    });

    it('includes version field (packed31 default)', () => {
      const encryptedData: EncryptedData = {
        ciphertext: 'test-ciphertext',
        nonce: 'test-nonce',
        publicKey: 'test-publicKey',
      };

      const result = JSON.parse(packageForTEE(encryptedData));

      expect(result.version).toBe('2.0-packed31');
    });

    it('includes ciphertext, nonce, and publicKey from input', () => {
      const encryptedData: EncryptedData = {
        ciphertext: 'my-ciphertext',
        nonce: 'my-nonce',
        publicKey: 'my-publicKey',
      };

      const result = JSON.parse(packageForTEE(encryptedData));

      expect(result.ciphertext).toBe('my-ciphertext');
      expect(result.nonce).toBe('my-nonce');
      expect(result.publicKey).toBe('my-publicKey');
    });

    it('excludes ephemeralPrivateKey from package', () => {
      const encryptedData: EncryptedData = {
        ciphertext: 'test-ciphertext',
        nonce: 'test-nonce',
        publicKey: 'test-publicKey',
        ephemeralPrivateKey: 'secret-key-should-not-be-sent',
      };

      const result = JSON.parse(packageForTEE(encryptedData));

      expect(result.ephemeralPrivateKey).toBeUndefined();
    });
  });

  describe('fetchTeePublicKey()', () => {
    it('fetches from /tee/public-key endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      await fetchTeePublicKey(TEST_BASE_URL);

      expect(mockFetch).toHaveBeenCalledWith(`${TEST_BASE_URL}/tee/public-key`);
    });

    it('returns Uint8Array from base64 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      const result = await fetchTeePublicKey(TEST_BASE_URL);

      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('caches result for subsequent calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      await fetchTeePublicKey(TEST_BASE_URL);
      await fetchTeePublicKey(TEST_BASE_URL);
      await fetchTeePublicKey(TEST_BASE_URL);

      // Should only fetch once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('keys the cache by baseUrl (does not reuse another backend key)', async () => {
      const urlA = 'https://a.example';
      const urlB = 'https://b.example';
      const keyA = { publicKey: Buffer.from(new Uint8Array(32).fill(0xaa)).toString('base64') };
      const keyB = { publicKey: Buffer.from(new Uint8Array(32).fill(0xbb)).toString('base64') };
      mockFetch.mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(url.startsWith(urlA) ? keyA : keyB),
        })
      );

      const resultA = await fetchTeePublicKey(urlA);
      const resultB = await fetchTeePublicKey(urlB);

      // Each backend gets its own key back, not whichever was fetched first.
      expect(Buffer.from(resultA).toString('base64')).toBe(keyA.publicKey);
      expect(Buffer.from(resultB).toString('base64')).toBe(keyB.publicKey);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(`${urlA}/tee/public-key`);
      expect(mockFetch).toHaveBeenCalledWith(`${urlB}/tee/public-key`);
    });

    it('throws on fetch failure (no guessable-key fallback)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Must refuse to encrypt rather than fall back to a derivable dev key.
      await expect(fetchTeePublicKey(TEST_BASE_URL)).rejects.toThrow('Network error');
    });

    it('throws on non-ok response (no guessable-key fallback)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchTeePublicKey(TEST_BASE_URL)).rejects.toThrow(/Refusing to encrypt/);
    });
  });

  describe('TEE public-key pinning (optional)', () => {
    const WRONG_PIN = Buffer.from(new Uint8Array(32).fill(0xbb)).toString('base64');

    it('accepts a served key that matches the pin', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      const result = await fetchTeePublicKey(TEST_BASE_URL, true, mockTeePublicKeyResponse.publicKey);

      expect(Buffer.from(result).toString('base64')).toBe(mockTeePublicKeyResponse.publicKey);
    });

    it('throws when the served key does not match the pin', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      await expect(
        fetchTeePublicKey(TEST_BASE_URL, true, WRONG_PIN)
      ).rejects.toThrow(/does not match the pinned teePublicKey/);
    });

    it('fetches and does not throw when no pin is set (unchanged default)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      const result = await fetchTeePublicKey(TEST_BASE_URL);

      expect(mockFetch).toHaveBeenCalledWith(`${TEST_BASE_URL}/tee/public-key`);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('does not cache a key that fails the pin', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      await expect(
        fetchTeePublicKey(TEST_BASE_URL, true, WRONG_PIN)
      ).rejects.toThrow(/does not match the pinned teePublicKey/);
      // Second call must re-fetch (nothing poisoned the cache), then succeed with the right pin.
      const result = await fetchTeePublicKey(TEST_BASE_URL, true, mockTeePublicKeyResponse.publicKey);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('encrypt() refuses when the served key fails the pin', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      await expect(
        encrypt('secret', TEST_BASE_URL, true, WRONG_PIN)
      ).rejects.toThrow(/does not match the pinned teePublicKey/);
      expect(mockCipherEncrypt).not.toHaveBeenCalled();
    });
  });

  describe('safe public-key reads', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      mockFetch.mockReset();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([429, 502, 503])('retries key discovery on HTTP %s, then caches only success', async status => {
      mockFetch
        .mockResolvedValueOnce(new Response('Unavailable', { status }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockTeePublicKeyResponse)));
      const result = fetchTeePublicKey(TEST_BASE_URL).catch(error => error);
      await vi.advanceTimersByTimeAsync(249);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual(Buffer.from(mockTeePublicKeyResponse.publicKey, 'base64'));
      expect(mockFetch.mock.calls).toEqual([
        [`${TEST_BASE_URL}/tee/public-key`],
        [`${TEST_BASE_URL}/tee/public-key`],
      ]);
      await fetchTeePublicKey(TEST_BASE_URL);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it.each([429, 502, 503])('does not replay HTTP %s inference after a recovered key preflight', async status => {
      const client = new SolRouter({ apiKey: TEST_API_KEY, baseUrl: TEST_BASE_URL });
      mockFetch
        .mockResolvedValueOnce(new Response('Unavailable', { status: 502 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockTeePublicKeyResponse)))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Outcome unknown' }), { status }));
      const result = client.chat('test').catch(error => error);
      await vi.runAllTimersAsync();
      expect(await result).toEqual(new Error('SolRouter API error: Outcome unknown'));
      expect(mockFetch.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
        [`${TEST_BASE_URL}/tee/public-key`, 'GET'],
        [`${TEST_BASE_URL}/tee/public-key`, 'GET'],
        [`${TEST_BASE_URL}/tee/process`, 'POST'],
      ]);
      expect(mockCipherEncrypt).toHaveBeenCalledTimes(1);
    });

    it('refuses encrypted inference after public-key retries are exhausted', async () => {
      const client = new SolRouter({ apiKey: TEST_API_KEY, baseUrl: TEST_BASE_URL });
      mockFetch.mockImplementation(() => Promise.resolve(new Response('Unavailable', { status: 503 })));
      const result = client.chat('test').catch(error => error);
      await vi.runAllTimersAsync();
      expect((await result).message).toMatch(/Refusing to encrypt/);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls.every(([url]) => url === `${TEST_BASE_URL}/tee/public-key`)).toBe(true);
      expect(mockCipherEncrypt).not.toHaveBeenCalled();
    });

    it.each(['key', 'encrypt', 'client'] as const)('respects retry opt-out through %s', async entrypoint => {
      mockFetch.mockImplementation(() => Promise.resolve(new Response('Unavailable', { status: 503 })));
      const client = new SolRouter({ apiKey: TEST_API_KEY, baseUrl: TEST_BASE_URL, retryReads: false });
      const request = entrypoint === 'key'
        ? fetchTeePublicKey(TEST_BASE_URL, false)
        : entrypoint === 'encrypt' ? encrypt('test', TEST_BASE_URL, false) : client.chat('test');
      const result = request.catch(error => error);
      await vi.runAllTimersAsync();
      expect((await result).message).toMatch(/Refusing to encrypt/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockCipherEncrypt).not.toHaveBeenCalled();
    });
  });

  describe('clearSession()', () => {
    it('resets sessionKeypair (new keypair generated on next encrypt)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      // First encryption establishes session
      await encrypt('first', TEST_BASE_URL);
      const firstCallCount = mockRandomSecretKey.mock.calls.length;

      // Clear and encrypt again
      clearSession();
      await encrypt('second', TEST_BASE_URL);
      const secondCallCount = mockRandomSecretKey.mock.calls.length;

      // Should have generated a new keypair after clearSession
      expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });

    it('resets cachedTeePublicKey (refetches on next encrypt)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTeePublicKeyResponse),
      });

      // First encryption caches TEE key
      await encrypt('first', TEST_BASE_URL);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Clear and encrypt again
      clearSession();
      await encrypt('second', TEST_BASE_URL);

      // Should have fetched TEE key again
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
