# Changelog

All notable changes to `@solrouter/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-09-27

The npm 1.2.0 tarball's `dist/` is byte-identical to a build of `585730e`, so it
includes the security fixes below. An earlier version of this file listed them as
unreleased.

### Security
- BRAID no longer sends your prompt in plaintext when encryption is on. The BRAID path
  routes through the plaintext `/agent` endpoint, which has no client-side encryption.
  With encryption enabled (the default) the SDK now throws instead of leaking the prompt.
  Pass `encrypted: false` to use BRAID. This is a runtime behavior change: a BRAID call
  that previously ran with default settings now throws until the caller opts out.
- Added an optional `teePublicKey` config field to pin the TEE X25519 public key. When
  set, the SDK compares the served key to the pin and refuses to encrypt on a mismatch,
  which blocks a compromised backend from substituting its own key. When unset, behavior
  is unchanged and the served key is trusted as before.

### Fixed
- The TEE public-key cache is now keyed by `baseUrl`. A single shared slot returned
  whichever backend was queried first, so a request to a different `baseUrl` could be
  encrypted to the wrong TEE key.
- BRAID requests now forward `systemPrompt`, `useRAG`, `ragCollection`, and
  `useLiveSearch` to the `/agent` endpoint. They were dropped before.
- The encrypted-response path guards a malformed 200 body. A missing or non-string
  `encryptedResponse` now surfaces as a structured `SolRouter API error` instead of a
  raw parser crash out of a paid call.

### Changed
- Default API base is now `https://api.solrouter.com` (was the raw Render origin).
- Safe reads (GET) retry transient failures with bounded exponential backoff and honour
  `Retry-After`. Paid requests are never replayed automatically.
- **Requires Node 20 or later.** Node 18 (end-of-life) cannot load the Arcium dependency
  tree: `rpc-websockets` `require()`s the ESM-only `uuid`.
- Corrected the API-key generation URL in the invalid-key error message to
  `solrouter.com/sdk` (previously pointed at an outdated host).
- Corrected `gpt-oss-20b` pricing in the README to $0.10 / $0.20 per 1M tokens to match
  the backend rate table.
- Rewrote the README: badges, model/pricing/privacy sections, and documentation for the
  `reasoning: 'braid'` option, the `client.skills` API, encryption opt-out, and the
  exported encryption primitives.
- Fixed `package.json` `repository` to point at `Router-Labs/router-sdk`; added `homepage`
  (`docs.solrouter.com`) and `bugs`.

### Added
- `LICENSE` (MIT), `CHANGELOG.md`, `.gitignore`, and a GitHub Actions CI workflow
  (build + test on Node 20, 22, and 24).

## [1.1.0]

### Added
- `client.skills.{list,get,match}` — introspect agentskills.io skills exposed by the backend.
- BRAID structured reasoning via `client.chat(prompt, { reasoning: 'braid' })`, with an
  optional `braidTrace` (GRD id, Mermaid graph, per-node timings) in the response.

### Changed
- Encryption now packs 31 bytes per field element (`version: '2.0-packed31'`) for ~25×
  faster TEE encrypt/decrypt, with a self-describing wire version for backward compatibility.
- Privacy mode is Nosana-only: self-hosted open-weight models (`gpt-oss-20b`, `qwen3-8b`)
  routed to per-model endpoints. No third-party model APIs.
- TEE processing runs on real Intel TDX (Phala dStack); bumped `@arcium-hq/client` to `^0.10.4`.
- API-key validation accepts real-world 44-character keys.

### Security
- Removed the guessable demo X25519 key fallback. If the TEE public key cannot be fetched,
  the SDK now refuses to encrypt rather than encrypting to a derivable key.

## [1.0.1]

### Changed
- Bumped `@arcium-hq/client` from `0.6.4` to `0.9.2`.
- Validate API keys on all routes and reject malformed keys client-side.

## [1.0.0]

### Added
- Initial release of `@solrouter/sdk`: encrypted-by-default `SolRouter` client,
  `client.chat()`, `client.getBalance()`, live web search, RAG options, and a connection
  test script under `examples/`.

[Unreleased]: https://github.com/Router-Labs/router-sdk/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Router-Labs/router-sdk/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Router-Labs/router-sdk/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Router-Labs/router-sdk/releases/tag/v1.0.0
