/**
 * SolRouter SDK - Main Client
 *
 * Privacy-first AI API client with end-to-end encryption.
 */

import { encrypt, decrypt, packageForTEE, clearSession } from './encryption.js';
import { fetchRead } from './read.js';
import type {
  SolRouterConfig,
  ChatOptions,
  ChatResponse,
  BalanceResponse,
  SkillSummary,
  Skill,
  SkillMatch,
} from './types.js';

const DEFAULT_BASE_URL = 'https://solrouter-obb4.onrender.com';
const DEFAULT_MODEL = 'gpt-oss-20b';

// Privacy mode: only self-hosted Nosana open-weight models are available.
const MODEL_MAP: Record<string, string> = {
  'gpt-oss-20b': 'nosana:gpt-oss:20b',
  'qwen3-8b': 'nosana:qwen3:8b',
};

export class SolRouter {
  private apiKey: string;
  private baseUrl: string;
  private encrypted: boolean;
  private retryReads: boolean;

  constructor(config: SolRouterConfig) {
    if (!config.apiKey) {
      throw new Error('SolRouter: apiKey is required');
    }
    if (!config.apiKey.startsWith('sk_solrouter_') || config.apiKey.length < 33) {
      throw new Error(
        'SolRouter: invalid apiKey format. Keys must start with "sk_solrouter_" followed by at least 20 random characters. Generate one at https://solrouter.com/sdk.'
      );
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.encrypted = config.encrypted !== false; // Default to true
    this.retryReads = config.retryReads !== false;
  }

  /**
   * Send a chat message with optional encryption
   *
   * @param prompt - The user's message
   * @param options - Chat options (model, encryption, etc.)
   * @returns The AI response
   */
  async chat(prompt: string, options: ChatOptions = {}): Promise<ChatResponse> {
    // BRAID reasoning path — routes through the agent endpoint
    if (options.reasoning === 'braid') {
      return this.braidChat(prompt, options);
    }

    const useEncryption = options.encrypted ?? this.encrypted;
    const model = MODEL_MAP[options.model || DEFAULT_MODEL] || options.model || MODEL_MAP[DEFAULT_MODEL];

    if (useEncryption) {
      return this.encryptedChat(prompt, model, options);
    } else {
      return this.plainChat(prompt, model, options);
    }
  }

  /**
   * BRAID-guided chat — routes to the agent endpoint with reasoning: 'braid'
   */
  private async braidChat(prompt: string, options: ChatOptions): Promise<ChatResponse> {
    const model = MODEL_MAP[options.model || DEFAULT_MODEL] || options.model || MODEL_MAP[DEFAULT_MODEL];

    const response = await fetch(`${this.baseUrl}/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        model,
        chatId: options.chatId,
        reasoning: 'braid',
        braidOptions: options.braidOptions,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; message?: string };
      throw new Error(`SolRouter API error: ${error.error || error.message || response.statusText}`);
    }

    const data = await response.json() as {
      success: boolean;
      reply: string;
      model?: string;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      braidTrace?: ChatResponse['braidTrace'];
    };

    return {
      message: data.reply,
      model: data.model || model,
      usage: data.usage,
      encrypted: false,
      braidTrace: data.braidTrace,
    };
  }

  /**
   * Encrypted chat - prompt is encrypted client-side
   */
  private async encryptedChat(
    prompt: string,
    model: string,
    options: ChatOptions
  ): Promise<ChatResponse> {
    // Encrypt the prompt
    const encryptedData = await encrypt(prompt, this.baseUrl, this.retryReads);
    const encryptedPackage = packageForTEE(encryptedData);

    // Send to TEE endpoint
    const response = await fetch(`${this.baseUrl}/tee/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        encryptedPrompt: encryptedPackage,
        model: model,
        chatId: options.chatId,
        systemPrompt: options.systemPrompt,
        useRAG: options.useRAG,
        ragCollection: options.ragCollection,
        useLiveSearch: options.useLiveSearch,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; message?: string };
      throw new Error(`SolRouter API error: ${error.error || error.message || response.statusText}`);
    }

    const data = await response.json() as {
      encryptedResponse: string;
      attestationHash?: string;
      metadata?: {
        model: string;
        promptTokens?: number;
        completionTokens?: number;
      };
      cost?: number;
      privacyAttestationId?: string;
    };

    // Decrypt the response
    const decryptedMessage = await decrypt(
      JSON.parse(data.encryptedResponse),
      encryptedData.ephemeralPrivateKey
    );

    return {
      message: decryptedMessage,
      model: data.metadata?.model || model,
      usage: data.metadata ? {
        promptTokens: data.metadata.promptTokens || 0,
        completionTokens: data.metadata.completionTokens || 0,
        totalTokens: (data.metadata.promptTokens || 0) + (data.metadata.completionTokens || 0),
      } : undefined,
      cost: data.cost,
      encrypted: true,
      privacyAttestationId: data.privacyAttestationId || data.attestationHash,
    };
  }

  /**
   * Plain chat - no encryption (for non-sensitive requests)
   */
  private async plainChat(
    prompt: string,
    model: string,
    options: ChatOptions
  ): Promise<ChatResponse> {
    // Determine the correct endpoint based on model
    const endpoint = this.getEndpointForModel(model);

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: prompt,
        model: model.split(':').pop(), // Extract model name
        chatId: options.chatId,
        systemPrompt: options.systemPrompt,
        useRAG: options.useRAG,
        ragCollection: options.ragCollection,
        useLiveSearch: options.useLiveSearch,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; message?: string };
      throw new Error(`SolRouter API error: ${error.error || error.message || response.statusText}`);
    }

    const data = await response.json() as {
      reply: string;
      model?: string;
      tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
      };
      cost?: number;
    };

    return {
      message: data.reply,
      model: data.model || model,
      usage: data.tokenUsage ? {
        promptTokens: data.tokenUsage.promptTokens,
        completionTokens: data.tokenUsage.completionTokens,
        totalTokens: data.tokenUsage.promptTokens + data.tokenUsage.completionTokens,
      } : undefined,
      cost: data.cost,
      encrypted: false,
    };
  }

  /**
   * Get endpoint for a given model
   */
  private getEndpointForModel(model: string): string {
    // Privacy mode: all models run on the self-hosted Nosana node.
    if (model.startsWith('nosana:')) return '/nosana';
    return '/router'; // Default intelligent routing (Nosana-backed)
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<BalanceResponse> {
    const response = await fetchRead(`${this.baseUrl}/api/v1/balance`, {
      'Authorization': `Bearer ${this.apiKey}`,
    }, this.retryReads);

    if (!response.ok) {
      throw new Error('Failed to fetch balance');
    }

    const data = await response.json() as { balance_usdc: number; balance_formatted: string };

    return {
      balance: data.balance_usdc,
      balanceFormatted: data.balance_formatted,
    };
  }

  /**
   * Agent Skills (agentskills.io) exposed by the SolRouter backend.
   *
   * The backend auto-injects matched SKILL.md content into /router calls,
   * so you don't need to call these to "use" a skill — they're for
   * introspection, listing in UIs, and pre-flight checks.
   *
   * @example
   *   const skills = await client.skills.list();
   *   const match = await client.skills.match('How do I use Arcium MPC?');
   */
  readonly skills = {
    list: async (): Promise<SkillSummary[]> => {
      const res = await fetchRead(`${this.baseUrl}/skills`, undefined, this.retryReads);
      if (!res.ok) throw new Error(`skills.list failed: ${res.status}`);
      const data = (await res.json()) as { skills?: SkillSummary[] };
      return Array.isArray(data?.skills) ? data.skills : [];
    },
    get: async (id: string): Promise<Skill> => {
      const res = await fetchRead(`${this.baseUrl}/skills/${encodeURIComponent(id)}`, undefined, this.retryReads);
      if (res.status === 404) throw new Error(`skill not found: ${id}`);
      if (!res.ok) throw new Error(`skills.get failed: ${res.status}`);
      return (await res.json()) as Skill;
    },
    match: async (prompt: string, limit = 3): Promise<SkillMatch[]> => {
      const res = await fetch(`${this.baseUrl}/skills/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, limit }),
      });
      if (!res.ok) throw new Error(`skills.match failed: ${res.status}`);
      const data = (await res.json()) as { matches?: SkillMatch[] };
      return Array.isArray(data?.matches) ? data.matches : [];
    },
  };

  /**
   * Clear encryption session (call on logout/cleanup)
   */
  clearSession(): void {
    clearSession();
  }
}
