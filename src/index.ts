

export { SolRouter } from './client.js';

export type {
  SolRouterConfig,
  ChatOptions,
  ChatResponse,
  EncryptedData,
  BalanceResponse,
  SkillSummary,
  Skill,
  SkillMatch,
} from './types.js';

// Re-export encryption utilities for advanced use cases
export {
  encrypt,
  decrypt,
  packageForTEE,
  clearSession,
  fetchTeePublicKey,
} from './encryption.js';
