/**
 * @solrouter/sdk
 *
 * Privacy-first AI API client with end-to-end encryption.
 *
 * @example
 * ```typescript
 * import { SolRouter } from '@solrouter/sdk';
 *
 * const client = new SolRouter({
 *   apiKey: 'sk_solrouter_your_key_here'
 * });
 *
 * // Encrypted by default
 * const response = await client.chat('Explain quantum computing');
 * console.log(response.message);
 * ```
 */

export { SolRouter } from './client.js';

export type {
  SolRouterConfig,
  ChatOptions,
  ChatResponse,
  EncryptedData,
  BalanceResponse,
} from './types.js';

// Re-export encryption utilities for advanced use cases
export {
  encrypt,
  decrypt,
  packageForTEE,
  clearSession,
  fetchTeePublicKey,
} from './encryption.js';
