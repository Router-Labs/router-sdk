/**
 * SolRouter Client Tests
 *
 * Tests for client initialization, plain chat, and encrypted chat functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SolRouter } from '../src/client.js';
import * as encryption from '../src/encryption.js';
import {
  mockPlainChatResponse,
  mockErrorResponse,
  TEST_API_KEY,
  TEST_BASE_URL,
  DEFAULT_BASE_URL,
  MODEL_MAPPINGS,
} from './fixtures/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock encryption module
vi.mock('../src/encryption.js', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  packageForTEE: vi.fn(),
  clearSession: vi.fn(),
  fetchTeePublicKey: vi.fn(),
}));

describe('SolRouter Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Client Initialization', () => {
    it('throws error when apiKey is missing', () => {
      expect(() => new SolRouter({ apiKey: '' })).toThrow('SolRouter: apiKey is required');
      expect(() => new SolRouter({} as any)).toThrow('SolRouter: apiKey is required');
    });

    it('accepts valid apiKey', () => {
      const client = new SolRouter({ apiKey: TEST_API_KEY });
      expect(client).toBeInstanceOf(SolRouter);
    });

    it('accepts real-world 44-char keys (server strips base64 chars, so random part can be <32)', () => {
      // Server-generated keys can be 30–32 random chars after sk_solrouter_ due to base64 stripping.
      const realShape = 'sk_solrouter_2IANWYHHgDF50CEOT2mgFWsWVMZOoLD'; // 44 chars, 31 random
      expect(() => new SolRouter({ apiKey: realShape })).not.toThrow();
    });

    it('rejects keys missing the sk_solrouter_ prefix', () => {
      expect(() => new SolRouter({ apiKey: 'sk_otherprefix_abcdefghijklmnop12345' })).toThrow(
        /invalid apiKey format/
      );
    });

    it('rejects keys that are too short', () => {
      expect(() => new SolRouter({ apiKey: 'sk_solrouter_short' })).toThrow(/invalid apiKey format/);
    });

    it('uses default baseUrl when not provided', async () => {
      const client = new SolRouter({ apiKey: TEST_API_KEY, encrypted: false });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlainChatResponse),
      });

      await client.chat('test');

      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_BASE_URL}/nosana`,
        expect.any(Object)
      );
    });

    it('accepts custom baseUrl', async () => {
      const client = new SolRouter({
        apiKey: TEST_API_KEY,
        baseUrl: TEST_BASE_URL,
        encrypted: false,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlainChatResponse),
      });

      await client.chat('test');

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/nosana`,
        expect.any(Object)
      );
    });

    it('defaults encryption to true', async () => {
      const client = new SolRouter({ apiKey: TEST_API_KEY });

      vi.mocked(encryption.encrypt).mockResolvedValue({
        ciphertext: 'encrypted',
        nonce: 'nonce',
        publicKey: 'pubkey',
        ephemeralPrivateKey: 'privkey',
      });
      vi.mocked(encryption.packageForTEE).mockReturnValue('{"encrypted": true}');
      vi.mocked(encryption.decrypt).mockResolvedValue('decrypted response');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({ ciphertext: 'x', nonce: 'y', publicKey: 'z' }),
            metadata: { model: 'test' },
          }),
      });

      await client.chat('test');

      // Should call TEE endpoint for encrypted chat
      expect(vi.mocked(encryption.encrypt).mock.calls[0]?.slice(0, 2))
        .toEqual(['test', DEFAULT_BASE_URL]);
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_BASE_URL}/tee/process`,
        expect.any(Object)
      );
    });

    it('respects encrypted: false config', async () => {
      const client = new SolRouter({
        apiKey: TEST_API_KEY,
        encrypted: false,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlainChatResponse),
      });

      await client.chat('test');

      // Should NOT call TEE endpoint
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/tee/process'),
        expect.any(Object)
      );
    });

    it('clearSession calls encryption clearSession', () => {
      const client = new SolRouter({ apiKey: TEST_API_KEY });
      client.clearSession();
      expect(encryption.clearSession).toHaveBeenCalled();
    });
  });

  describe('Chat - Plain Mode', () => {
    let client: SolRouter;

    beforeEach(() => {
      client = new SolRouter({
        apiKey: TEST_API_KEY,
        baseUrl: TEST_BASE_URL,
        encrypted: false,
      });
    });

    describe('Model Routing', () => {
      it.each([
        ['gpt-oss-20b', '/nosana'],
        ['qwen3-8b', '/nosana'],
      ])('routes %s to %s endpoint', async (model, expectedEndpoint) => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPlainChatResponse),
        });

        await client.chat('test', { model: model as any });

        expect(mockFetch).toHaveBeenCalledWith(
          `${TEST_BASE_URL}${expectedEndpoint}`,
          expect.any(Object)
        );
      });

      it('routes unknown model to /router endpoint', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPlainChatResponse),
        });

        await client.chat('test', { model: 'unknown-model' as any });

        expect(mockFetch).toHaveBeenCalledWith(`${TEST_BASE_URL}/router`, expect.any(Object));
      });
    });

    describe('Model Mapping', () => {
      it.each(Object.entries(MODEL_MAPPINGS))(
        'maps %s to %s',
        async (shortName, fullName) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockPlainChatResponse),
          });

          await client.chat('test', { model: shortName as any });

          const callArgs = mockFetch.mock.calls[0];
          const body = JSON.parse(callArgs[1].body);
          // Model name is extracted (split(':').pop())
          expect(body.model).toBe(fullName.split(':').pop());
        }
      );
    });

    describe('Request Payload', () => {
      it('sends correct payload with all options', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPlainChatResponse),
        });

        await client.chat('Hello AI', {
          model: 'gpt-oss-20b',
          systemPrompt: 'You are helpful',
          chatId: 'chat-123',
          useRAG: true,
          ragCollection: 'my-docs',
          useLiveSearch: true,
        });

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);

        expect(body).toEqual({
          prompt: 'Hello AI',
          model: '20b',
          systemPrompt: 'You are helpful',
          chatId: 'chat-123',
          useRAG: true,
          ragCollection: 'my-docs',
          useLiveSearch: true,
        });
      });

      it('sends Authorization header with Bearer token', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPlainChatResponse),
        });

        await client.chat('test');

        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[1].headers).toMatchObject({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_KEY}`,
        });
      });
    });

    describe('Response Handling', () => {
      it('returns ChatResponse with all fields', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPlainChatResponse),
        });

        const response = await client.chat('test');

        expect(response).toEqual({
          message: mockPlainChatResponse.reply,
          model: mockPlainChatResponse.model,
          usage: {
            promptTokens: mockPlainChatResponse.tokenUsage.promptTokens,
            completionTokens: mockPlainChatResponse.tokenUsage.completionTokens,
            totalTokens:
              mockPlainChatResponse.tokenUsage.promptTokens +
              mockPlainChatResponse.tokenUsage.completionTokens,
          },
          cost: mockPlainChatResponse.cost,
          encrypted: false,
        });
      });

      it('returns encrypted: false for plain chat', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPlainChatResponse),
        });

        const response = await client.chat('test');

        expect(response.encrypted).toBe(false);
        expect(response.privacyAttestationId).toBeUndefined();
      });

      it('handles response without tokenUsage', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ reply: 'response', model: 'test' }),
        });

        const response = await client.chat('test');

        expect(response.message).toBe('response');
        expect(response.usage).toBeUndefined();
      });
    });

    describe('Error Handling', () => {
      it('throws error with API error message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: 'Bad Request',
          json: () => Promise.resolve(mockErrorResponse),
        });

        await expect(client.chat('test')).rejects.toThrow(
          `SolRouter API error: ${mockErrorResponse.error}`
        );
      });

      it('throws error with statusText when no error body', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: 'Internal Server Error',
          json: () => Promise.reject(new Error('Parse error')),
        });

        await expect(client.chat('test')).rejects.toThrow(
          'SolRouter API error: Unknown error'
        );
      });
    });
  });

  describe('Chat - Encrypted Mode', () => {
    let client: SolRouter;

    beforeEach(() => {
      client = new SolRouter({
        apiKey: TEST_API_KEY,
        baseUrl: TEST_BASE_URL,
        encrypted: true,
      });

      // Set up encryption mocks
      vi.mocked(encryption.encrypt).mockResolvedValue({
        ciphertext: 'encrypted-ciphertext',
        nonce: 'nonce-value',
        publicKey: 'public-key',
        ephemeralPrivateKey: 'private-key',
      });
      vi.mocked(encryption.packageForTEE).mockReturnValue(
        '{"ciphertext":"encrypted","algorithm":"Arcium-RescueCipher"}'
      );
      vi.mocked(encryption.decrypt).mockResolvedValue('Decrypted AI response');
    });

    it('calls /tee/process endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({
              ciphertext: 'x',
              nonce: 'y',
              publicKey: 'z',
            }),
            metadata: { model: 'test' },
          }),
      });

      await client.chat('test');

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/tee/process`,
        expect.any(Object)
      );
    });

    it('encrypts prompt client-side before sending', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({
              ciphertext: 'x',
              nonce: 'y',
              publicKey: 'z',
            }),
            metadata: { model: 'test' },
          }),
      });

      await client.chat('sensitive prompt');

      expect(encryption.encrypt).toHaveBeenCalledWith('sensitive prompt', TEST_BASE_URL);
      expect(encryption.packageForTEE).toHaveBeenCalled();
    });

    it('sends encryptedPrompt in request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({
              ciphertext: 'x',
              nonce: 'y',
              publicKey: 'z',
            }),
            metadata: { model: 'test' },
          }),
      });

      await client.chat('test', { model: 'gpt-oss-20b' });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.encryptedPrompt).toBe(
        '{"ciphertext":"encrypted","algorithm":"Arcium-RescueCipher"}'
      );
      expect(body.model).toBe('nosana:gpt-oss:20b');
    });

    it('decrypts response using ephemeral private key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({
              ciphertext: 'encrypted-response',
              nonce: 'resp-nonce',
              publicKey: 'tee-pubkey',
            }),
            metadata: { model: 'test' },
          }),
      });

      await client.chat('test');

      expect(encryption.decrypt).toHaveBeenCalledWith(
        {
          ciphertext: 'encrypted-response',
          nonce: 'resp-nonce',
          publicKey: 'tee-pubkey',
        },
        'private-key' // ephemeralPrivateKey from encrypt result
      );
    });

    it('returns encrypted: true and privacyAttestationId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({
              ciphertext: 'x',
              nonce: 'y',
              publicKey: 'z',
            }),
            metadata: { model: 'test-model' },
            privacyAttestationId: 'attest-123',
            cost: 0.001,
          }),
      });

      const response = await client.chat('test');

      expect(response.encrypted).toBe(true);
      expect(response.privacyAttestationId).toBe('attest-123');
      expect(response.message).toBe('Decrypted AI response');
    });

    it('falls back to attestationHash if privacyAttestationId not present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({
              ciphertext: 'x',
              nonce: 'y',
              publicKey: 'z',
            }),
            metadata: { model: 'test' },
            attestationHash: 'hash-456',
          }),
      });

      const response = await client.chat('test');

      expect(response.privacyAttestationId).toBe('hash-456');
    });

    it('supports all ChatOptions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            encryptedResponse: JSON.stringify({
              ciphertext: 'x',
              nonce: 'y',
              publicKey: 'z',
            }),
            metadata: { model: 'test' },
          }),
      });

      await client.chat('test', {
        model: 'gpt-oss-20b',
        systemPrompt: 'Be helpful',
        chatId: 'conv-123',
        useRAG: true,
        ragCollection: 'docs',
        useLiveSearch: true,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body).toMatchObject({
        model: 'nosana:gpt-oss:20b',
        systemPrompt: 'Be helpful',
        chatId: 'conv-123',
        useRAG: true,
        ragCollection: 'docs',
        useLiveSearch: true,
      });
    });

    it('per-request encrypted option overrides client config', async () => {
      // Client has encryption enabled by default
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlainChatResponse),
      });

      // But this request disables it
      await client.chat('test', { encrypted: false });

      // Should call plain endpoint, not TEE
      expect(mockFetch).toHaveBeenCalledWith(
        expect.not.stringContaining('/tee/process'),
        expect.any(Object)
      );
      expect(encryption.encrypt).not.toHaveBeenCalled();
    });

    describe('Error Handling', () => {
      it('throws error when TEE endpoint fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: 'Service Unavailable',
          json: () => Promise.resolve({ error: 'TEE unavailable' }),
        });

        await expect(client.chat('test')).rejects.toThrow('SolRouter API error: TEE unavailable');
      });
    });
  });
});
