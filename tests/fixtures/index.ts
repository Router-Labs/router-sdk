/**
 * Test fixtures for @solrouter/sdk
 */

// Mock API responses
export const mockPlainChatResponse = {
  reply: 'This is a test response from the AI model.',
  model: 'nosana:gpt-oss:20b',
  tokenUsage: {
    promptTokens: 10,
    completionTokens: 20,
  },
  cost: 0.0001,
};

export const mockEncryptedChatResponse = {
  encryptedResponse: '', // Will be set dynamically in tests
  attestationHash: 'attest_abc123',
  metadata: {
    model: 'nosana:gpt-oss:20b',
    promptTokens: 10,
    completionTokens: 20,
  },
  cost: 0.0001,
  privacyAttestationId: 'privacy_xyz789',
};

export const mockBalanceResponse = {
  balance_usdc: 10.5432,
  balance_formatted: '$10.5432 USDC',
};

export const mockTeePublicKeyResponse = {
  publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // 32 bytes base64
};

// Error responses
export const mockErrorResponse = {
  error: 'Invalid API key',
};

export const mockUnauthorizedResponse = {
  error: 'Unauthorized',
  message: 'Invalid or expired token',
};

// Model mapping expectations
export const MODEL_MAPPINGS = {
  'gpt-oss-20b': 'nosana:gpt-oss:20b',
  'gemini-flash': 'gemini:gemini-2.0-flash-exp',
  'claude-sonnet': 'claude:claude-3-5-sonnet-20241022',
  'claude-sonnet-4': 'claude:claude-sonnet-4-20250514',
  'gpt-4o-mini': 'openai:gpt-4o-mini',
} as const;

// Endpoint mapping expectations
export const ENDPOINT_MAPPINGS = {
  'nosana:': '/nosana',
  'gemini:': '/gemini',
  'claude:': '/claude',
  'openai:': '/openai',
  'unknown:': '/router',
} as const;

// Test constants
export const TEST_API_KEY = 'sk_solrouter_test_key_1234567890abcdef';
export const TEST_BASE_URL = 'https://test.solrouter.com';
export const DEFAULT_BASE_URL = 'https://solrouter-obb4.onrender.com';

// Mock encrypted data structure
export const mockEncryptedData = {
  ciphertext: 'base64encodedciphertext',
  nonce: 'base64encodednonce',
  publicKey: 'base64encodedpublickey',
  ephemeralPrivateKey: 'base64encodedprivatekey',
};
