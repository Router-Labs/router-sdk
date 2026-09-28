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
  retryReads: true,             // Optional. Bounded safe-read retries (default: true).
  teePublicKey: '<base64>',     // Optional. Pin the TEE key; throws on mismatch (default: none).
});
```

Set `teePublicKey` to a base64 TEE X25519 public key to pin it. When set, the SDK
compares the key served by `GET /tee/public-key` to your pinned value and refuses
to encrypt on a mismatch, so a compromised backend cannot substitute its own key
and read your prompts. When unset, the served key is trusted as before. See
[Privacy Guarantee](#privacy-guarantee).

The default `baseUrl` is `https://api.solrouter.com`. Pass your own `baseUrl` to
point at a self-hosted backend; explicit URLs are never rewritten. The connection
example also accepts `SOLROUTER_BASE_URL` as an override.

This default takes effect when the updated SDK is released and your application
upgrades to it. Existing installed SDKs and explicit legacy Render URLs are not
changed by a server deployment. Keep the legacy origin available until those
clients migrate; no automatic fallback or request replay is added by this change.

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
pipeline and (optionally) receive an execution trace. The BRAID path runs through
the plaintext `/agent` endpoint and does not support client-side encryption, so you
must pass `encrypted: false`. With encryption left on (the default) the SDK throws
instead of sending your prompt in cleartext:

```typescript
const response = await client.chat('Plan a multi-step migration', {
  reasoning: 'braid',
  encrypted: false,
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

## Retries and backoff

The SDK automatically retries **only safe GET reads**: `getBalance()`,
`skills.list()`, `skills.get()`, and TEE public-key discovery (including the
preflight performed by encrypted chat). The policy is:

- Retry HTTP **429, 502 and 503** only, with at most **two retries** after the
  initial request (three attempts total).
- Exponential backoff with jitter: the first delay is 250–499 ms and the second
  is 500–999 ms when the server supplies no longer cooldown.
- Honor a readable `Retry-After` header expressed as non-negative integer seconds
  or an HTTP-date. Wait for the greater of the server cooldown and the local
  backoff. Missing, malformed, zero or past values use the local backoff.
- Each retry wait is bounded to **30 seconds**. If the server asks for longer,
  stop and surface the existing method error; do **not** shorten its cooldown and
  retry early. Retry sleeps total at most 60 seconds; this is **not** a total
  network timeout. Browsers can read `Retry-After` cross-origin only if the server
  exposes that header through CORS.
- Network errors, aborts, JSON parse failures and other HTTP statuses are not
  retried. Existing result shapes and terminal error messages are unchanged.

Set `retryReads: false` in the constructor to retain the previous single-attempt
behavior, for example when your application already owns the retry budget. The
standalone helpers also accept an opt-out: `fetchTeePublicKey(baseUrl, false)` and
`encrypt(message, baseUrl, false)`. An exhausted public-key read still refuses to
encrypt; no fallback key or plaintext fallback is introduced.

**POST requests are never automatically replayed**, including plain/encrypted
chat, BRAID and `skills.match()`. An inference request may have been processed or
charged before a gateway error reaches the caller. Do not wrap chat, payment or
swap operations in a generic retry loop without a documented server-side
idempotency guarantee. The public-key preflight can retry; the inference POST
that follows it cannot.

### Subscription plans and server responsibilities

This SDK does not currently expose a `/subscriptions/plans` reader. The shared
safe-read policy addresses the SDK backoff portion of
[issue #2](https://github.com/Router-Labs/router-sdk/issues/2); it does not change
application-owned `fetch` calls to that endpoint or add a local plans cache.
If an application adds such a cache, use a bounded TTL, key it by backend and
all request parameters (including offer codes), coalesce concurrent reads, and
do not cache errors or personalized eligibility. Cached prices must not replace
server-side validation when purchasing.

SDK retries are not server rate limiting. Avoid tight caller retry loops or
unbounded polling regardless of which backend deployment you use. Catalogue
caching, rate-limit enforcement, response headers and 502/503 monitoring remain
backend/deployment responsibilities; see
[SolRouter #217](https://github.com/Router-Labs/SolRouter/pull/217) for server-side
plans protection. Its merge alone does not establish production deployment.

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

### Trust model and current limits

Be honest about what protects your prompt today. Client-side confidentiality
currently depends on trusting the backend to return a genuine TEE public key. The
SDK fetches that key from `GET /tee/public-key` and, by default, does not verify it
against a hardware attestation. A malicious or compromised backend could serve its
own key and read your prompts (key substitution).

Two mitigations exist:

- **Pin the key.** Pass `teePublicKey` (base64) in the constructor. The SDK then
  compares the served key to your pin and refuses to encrypt on a mismatch. Get the
  expected key from a trusted channel (for example, a value you verified once and
  stored).
- **Full attestation is a tracked follow-up.** End-to-end Intel TDX (Phala dstack)
  attestation that binds the enclave to the served key, so the SDK can verify it before
  encrypting, is planned. Binding the key alone is not enough: real verification must
  also check the enclave measurements (MRTD and the RTMR event log), so the SDK trusts
  the intended enclave and not just any genuine TDX enclave. Tracked in
  [SolRouter#230](https://github.com/Router-Labs/SolRouter/issues/230).

Server responses also use the RescueCipher without a separate authentication tag, so
tampering or truncation of a response is not currently detected client-side. Response
integrity is a tracked follow-up.

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
