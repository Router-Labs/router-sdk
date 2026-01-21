/**
 * SolRouter SDK Types
 */

export interface SolRouterConfig {
  /** Your SolRouter API key (starts with sk_solrouter_) */
  apiKey: string;
  /** API base URL (defaults to https://solrouter-obb4.onrender.com) */
  baseUrl?: string;
  /** Enable encryption (defaults to true) */
  encrypted?: boolean;
}

export interface ChatOptions {
  /** Model to use (defaults to gpt-oss-20b) */
  model?: 'gpt-oss-20b' | 'gemini-flash' | 'claude-sonnet' | 'claude-sonnet-4' | 'gpt-4o-mini';
  /** System prompt */
  systemPrompt?: string;
  /** Enable encryption for this request (overrides client setting) */
  encrypted?: boolean;
  /** Conversation ID for multi-turn conversations */
  chatId?: string;
  /** Enable RAG (knowledge base retrieval) */
  useRAG?: boolean;
  /** RAG collection to use */
  ragCollection?: string;
  /** Enable live web search */
  useLiveSearch?: boolean;
}

export interface ChatResponse {
  /** The AI response message */
  message: string;
  /** Model used for generation */
  model: string;
  /** Token usage statistics */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Cost of this request in USDC */
  cost?: number;
  /** Whether the request was encrypted */
  encrypted: boolean;
  /** Privacy attestation ID (if encrypted) */
  privacyAttestationId?: string;
}

export interface EncryptedData {
  ciphertext: string;
  nonce: string;
  publicKey: string;
  ephemeralPrivateKey?: string;
}

export interface BalanceResponse {
  balance: number;
  balanceFormatted: string;
}
