# @solrouter/sdk

[![npm version](https://img.shields.io/npm/v/@solrouter/sdk.svg)](https://www.npmjs.com/package/@solrouter/sdk)
[![CI](https://github.com/Router-Labs/router-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Router-Labs/router-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

**Privacy-first AI API client with end-to-end encryption.**

Your prompts are encrypted on your device before they ever leave it. The SolRouter
backend is a blind relay — it routes the encrypted blob without being able to read
it. Decryption happens only inside a hardware-isolated Trusted Execution Environment
(Intel TDX). Billed per call in USDC or `$ROUTER` on Solana — no email, no account.

> Full documentation: **[docs.solrouter.com](https://docs.solrouter.com)**

## Installation

```bash
npm install @solrouter/sdk
# or
yarn add @solrouter/sdk
# or
pnpm add @solrouter/sdk
```

Requires Node.js ≥ 18.

## Quick Start

```typescript
import { SolRouter } from '@solrouter/sdk';

const client = new SolRouter({
  apiKey: 'sk_solrouter_your_key_here',
});

// Encrypted client-side by default
const response = await client.chat('Explain quantum computing');
console.log(response.message);
```

## How It Works

1. **Client-side encryption** — your prompt is encrypted with Arcium's `RescueCipher`
   over an ephemeral X25519 key exchange before leaving your device. No wallet
   signature required.
2. **Blind backend** — the server only ever sees ciphertext. It cannot read your prompt.
3. **TEE processing** — decryption happens only inside a hardware-isolated Intel TDX
   enclave (Phala dStack).
4. **Encrypted response** — the model's reply is encrypted back to you and decrypted
   locally.

## API Reference

### `new SolRouter(config)`

```typescript
const client = new SolRouter({
  apiKey: 'sk_solrouter_...',   // Required. Keys start with "sk_solrouter_".
  baseUrl: 'https://...',       // Optional. Defaults to the SolRouter production API.
  encrypted: true,              // Optional. Encrypt by default (default: true).
});
```

The default `baseUrl` targets SolRouter production. The canonical production host is
`https://api.solrouter.com`; pass your own `baseUrl` to point at a self-hosted backend.

### `client.chat(prompt, options?)`

```typescript
const response = await client.chat('Hello!', {
  model: 'gpt-oss-20b',          // 'gpt-oss-20b' (default) | 'qwen3-8b'
  encrypted: true,               // Override the client-level encryption setting
  systemPrompt: 'You are...',    // System prompt
  chatId: 'conv-123',            // Carry context across a multi-turn conversation
  useRAG: false,                 // Retrieve from a knowledge base
  ragCollection: 'my-docs',      // RAG collection to query (when useRAG is true)
  useLiveSearch: false,          // Augment with live web search
  reasoning: 'default',          // 'default' | 'braid' (structured reasoning)
});

console.log(response.message);              // AI response
console.log(response.encrypted);            // Whether the request was encrypted
console.log(response.usage);                // { promptTokens, completionTokens, totalTokens }
console.log(response.cost);                 // Cost of this request in USDC
console.log(response.privacyAttestationId); // On-chain attestation id (encrypted requests)
```

Returns a [`ChatResponse`](./src/types.ts).

#### Opting out of encryption

For non-sensitive requests you can disable encryption per call (or per client):

```typescript
const response = await client.chat('Summarize this public article', {
  encrypted: false,
});
```

#### BRAID structured reasoning

Set `reasoning: 'braid'` to route the request through SolRouter's BRAID reasoning
pipeline and (optionally) receive an execution trace:

```typescript
const response = await client.chat('Plan a multi-step migration', {
  reasoning: 'braid',
  braidOptions: { includeTrace: true },
});

console.log(response.braidTrace); // GRD id, Mermaid graph, per-node timings
```

### `client.getBalance()`

```typescript
const balance = await client.getBalance();
console.log(balance.balanceFormatted); // "$10.5000 USDC"
console.log(balance.balance);          // 10.5
```

### `client.skills`

Introspect the [agentskills.io](https://agentskills.io) skills the backend can inject
into `/router` calls. These are for listing and pre-flight checks — the backend
auto-injects matched skills, so you don't need to call these to *use* a skill.

```typescript
const all = await client.skills.list();              // SkillSummary[]
const skill = await client.skills.get('arcium-mpc');  // Skill (full SKILL.md body)
const matches = await client.skills.match('How do I use Arcium MPC?', 3); // SkillMatch[]
```

### `client.clearSession()`

Clears the in-memory ephemeral keypair and cached TEE public key. Call on logout or
cleanup.

```typescript
client.clearSession();
```

### Advanced: encryption primitives

For custom transports, the encryption helpers are exported directly. They operate on
the exported `EncryptedData` type:

```typescript
import { encrypt, decrypt, packageForTEE, fetchTeePublicKey, clearSession } from '@solrouter/sdk';
import type { EncryptedData } from '@solrouter/sdk';
```

## Available Models

Privacy mode runs only self-hosted, open-weight models on the Nosana decentralized GPU
network. No third-party model APIs ever see your traffic.

| Model         | Description                                    |
|---------------|------------------------------------------------|
| `gpt-oss-20b` | Open-weight GPT-OSS 20B on Nosana (**default**) |
| `qwen3-8b`    | Open-weight Qwen 3 8B on Nosana                |

## Pricing

Pay-per-call from a prepaid balance in USDC or `$ROUTER`. Rates in USD per 1M tokens:

| Model         | Input  | Output |
|---------------|--------|--------|
| `gpt-oss-20b` | $0.10  | $0.20  |
| `qwen3-8b`    | $0.05  | $0.10  |

Live pricing is returned by the backend; see [docs.solrouter.com](https://docs.solrouter.com).

## Privacy Guarantee

When encryption is enabled (the default):

- Prompts are encrypted on your device with Arcium's `RescueCipher` (X25519 key exchange).
- The SolRouter backend **never** sees your plaintext prompts.
- Decryption happens only inside a hardware-isolated Intel TDX enclave.
- On-chain privacy attestations (Light Protocol) are available for verification.

If the TEE public key cannot be fetched, the SDK **refuses to encrypt** rather than
falling back to a guessable key.

## Testing Your Setup

The package ships a connection test script. After installing, copy it out of
`node_modules` and run it with your API key:

```bash
cp node_modules/@solrouter/sdk/examples/test-connection.ts ./
SOLROUTER_API_KEY=sk_solrouter_xxx npx tsx test-connection.ts
```

It verifies (1) API key validity, (2) encrypted chat, and (3) live web search:

```
==================================================
  SolRouter SDK Connection Test
==================================================
[1/3] Testing API Key...
  ✓ API key is valid
  Balance: $10.5000 USDC

[2/3] Testing Encrypted Chat...
  ✓ Encrypted chat working
  Response: "4"
  Encrypted: true

[3/3] Testing Live Search...
  ✓ Live search working

  3/3 tests passed
```

## Get an API Key

1. Visit **[solrouter.com/sdk](https://solrouter.com/sdk)**
2. Connect your Solana wallet
3. Generate an API key (format: `sk_solrouter_...`)
4. Top up your prepaid balance in USDC or `$ROUTER`

## Links

- **Docs** — [docs.solrouter.com](https://docs.solrouter.com)
- **Get an API key** — [solrouter.com/sdk](https://solrouter.com/sdk)
- **npm** — [@solrouter/sdk](https://www.npmjs.com/package/@solrouter/sdk)
- **GitHub** — [Router-Labs/router-sdk](https://github.com/Router-Labs/router-sdk)

## License

[MIT](./LICENSE) © SolRouter
