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
  /** Model to use (defaults to gpt-oss-20b). Privacy mode: self-hosted Nosana open-weight models only. */
  model?: 'gpt-oss-20b' | 'qwen3-8b';
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
  /** Reasoning mode: 'default' for standard, 'braid' for BRAID-guided reasoning */
  reasoning?: 'default' | 'braid';
  /** BRAID-specific options (only used when reasoning is 'braid') */
  braidOptions?: {
    /** Include GRD execution trace in the response */
    includeTrace?: boolean;
    /** Force a specific GRD by ID */
    forceGrdId?: string;
  };
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
  /** BRAID execution trace (when reasoning: 'braid' and braidOptions.includeTrace: true) */
  braidTrace?: {
    grdId: string;
    grdMermaid: string;
    intent: string;
    nodes: Array<{
      nodeId: string;
      label: string;
      type: string;
      status: string;
      durationMs?: number;
      tokensUsed?: number;
    }>;
    totalDurationMs: number;
    totalTokens: number;
    ppd?: number;
  };
}

export interface EncryptedData {
  ciphertext: string;
  nonce: string;
  publicKey: string;
  ephemeralPrivateKey?: string;
  // Encoding tag the TEE echoes on its response ('1.0' = 1 byte/element,
  // '2.0-packed31' = 31 bytes/element). Drives version-aware decoding.
  version?: string;
}

export interface BalanceResponse {
  balance: number;
  balanceFormatted: string;
}

/** Summary returned by GET /skills — one entry per installed SKILL.md */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version: string | null;
  compatibility?: string | null;
  metadata?: Record<string, unknown> | null;
  bodyLength: number;
}

/** Full SKILL.md detail returned by GET /skills/:id */
export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string | null;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, unknown> | null;
  /** Full markdown body of SKILL.md (after YAML frontmatter) */
  body: string;
}

/** A matched skill from POST /skills/match — description trimmed for UI */
export interface SkillMatch {
  id: string;
  name: string;
  description: string;
}
