/**
 * SolRouter SDK - Arcium Encryption
 *
 * Handles client-side encryption using Arcium's RescueCipher.
 * No wallet signatures required - uses ephemeral X25519 key exchange.
 */

import { RescueCipher, x25519 } from '@arcium-hq/client';
import { fetchRead } from './read.js';
import type { EncryptedData } from './types.js';

// Byte-packing for RescueCipher. The cipher runs one (expensive) permutation
// per field element, so encoding 1 byte/element — the legacy "1.0" format — is
// ~31x more work than necessary. The Curve25519 base field holds 248 bits, so
// we pack 31 bytes/element with a 4-byte LE length header (self-describing).
// MUST match tee-service/src/index.js packBytes/unpackBytes exactly; the wire
// `version` tag tells the TEE which encoding to use, so old clients are safe.
const PACK_BYTES = 31;
export const ENCRYPTION_VERSION = '2.0-packed31'; // legacy 1-byte = '1.0'

function packBytes(bytes: Uint8Array): bigint[] {
  const len = bytes.length;
  const buf = new Uint8Array(4 + len);
  buf[0] = len & 0xff;
  buf[1] = (len >> 8) & 0xff;
  buf[2] = (len >> 16) & 0xff;
  buf[3] = (len >> 24) & 0xff;
  buf.set(bytes, 4);
  const out: bigint[] = [];
  for (let i = 0; i < buf.length; i += PACK_BYTES) {
    let v = 0n;
    for (let j = 0; j < PACK_BYTES && i + j < buf.length; j++) {
      v += BigInt(buf[i + j]) << BigInt(8 * j);
    }
    out.push(v);
  }
  return out;
}

function unpackBytes(elems: Array<bigint | number>): Uint8Array {
  const bytes: number[] = [];
  for (const raw of elems) {
    let v = BigInt(raw);
    for (let j = 0; j < PACK_BYTES; j++) {
      bytes.push(Number(v & 0xffn));
      v >>= 8n;
    }
  }
  const len = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return new Uint8Array(bytes.slice(4, 4 + len));
}

// Session keypair (generated once per SDK instance)
let sessionKeypair: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;

// Cached TEE public key, keyed by baseUrl. Each backend (the canonical API, a
// self-hosted deployment, or the legacy origin) publishes its own TEE key. A
// single shared slot would return whichever backend was queried first, so a
// later request to a different baseUrl would be encrypted to the wrong TEE.
const cachedTeePublicKeys = new Map<string, Uint8Array>();

/**
 * Initialize or get the session keypair
 */
function getSessionKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  if (!sessionKeypair) {
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    sessionKeypair = { privateKey, publicKey };
  }
  return sessionKeypair;
}

// Optional key pinning. When the caller pins a base64 TEE key, the served key
// must match it byte-for-byte or we refuse to encrypt. This is an interim
// mitigation for the absence of TDX attestation: without a pin the SDK still
// trusts whatever key the backend serves, so a compromised backend could
// substitute its own key and read prompts. Public-key comparison, so a plain
// byte-equal check is enough (no secret, no timing concern).
function assertPinnedKey(fetched: Uint8Array, expectedBase64: string | undefined, baseUrl: string): void {
  if (!expectedBase64) return;
  const expected = Buffer.from(expectedBase64, 'base64');
  if (expected.length !== fetched.length || !Buffer.from(fetched).equals(expected)) {
    throw new Error(
      `SolRouter: TEE public key served by ${baseUrl}/tee/public-key does not match the pinned teePublicKey. ` +
      `Refusing to encrypt — the backend may be substituting keys (possible MITM).`
    );
  }
}

/**
 * Fetch TEE public key from server
 * @param retryReads - Retry transient read responses (default: true)
 * @param expectedPublicKey - Optional base64 key to pin; throws on mismatch (default: no pin)
 */
export async function fetchTeePublicKey(
  baseUrl: string,
  retryReads = true,
  expectedPublicKey?: string,
): Promise<Uint8Array> {
  const cached = cachedTeePublicKeys.get(baseUrl);
  if (cached) {
    assertPinnedKey(cached, expectedPublicKey, baseUrl);
    return cached;
  }

  // No fallback: if the TEE is unreachable we MUST refuse to encrypt rather
  // than fall back to a guessable key. The previous Uint8Array(32).fill(42)
  // fallback had a publicly-derivable private key — encrypting to it would
  // have made the ciphertext readable by anyone.
  const response = await fetchRead(`${baseUrl}/tee/public-key`, undefined, retryReads);
  if (!response.ok) {
    throw new Error(
      `Cannot fetch TEE public key from ${baseUrl}/tee/public-key (status ${response.status}). ` +
      `Refusing to encrypt — would risk sending plaintext or encrypting to a guessable key.`
    );
  }
  const data = await response.json() as { publicKey: string };
  if (!data?.publicKey) {
    throw new Error('TEE /public-key response missing publicKey field');
  }
  const teePublicKey = Buffer.from(data.publicKey, 'base64');
  // Verify the pin before caching so a mismatched key never poisons the cache.
  assertPinnedKey(teePublicKey, expectedPublicKey, baseUrl);
  cachedTeePublicKeys.set(baseUrl, teePublicKey);
  return teePublicKey;
}

/**
 * Encrypt a message using Arcium's RescueCipher
 *
 * @param message - The plaintext message to encrypt
 * @param baseUrl - API base URL (for fetching TEE public key)
 * @param retryReads - Retry transient public-key read responses (default: true)
 * @param expectedTeePublicKey - Optional base64 key to pin; throws on mismatch (default: no pin)
 * @returns Encrypted data bundle
 */
export async function encrypt(
  message: string,
  baseUrl: string,
  retryReads = true,
  expectedTeePublicKey?: string,
): Promise<EncryptedData> {
  // Get session keypair
  const { privateKey, publicKey } = getSessionKeypair();

  // Get TEE public key
  const teePublicKey = await fetchTeePublicKey(baseUrl, retryReads, expectedTeePublicKey);

  // Convert message to field elements (31 bytes/element — see packBytes).
  const messageBytes = new TextEncoder().encode(message);
  const plaintextBigInts = packBytes(messageBytes);

  // Create shared secret with TEE
  const sharedSecret = x25519.getSharedSecret(privateKey, teePublicKey);

  // Generate random nonce
  const nonce = crypto.getRandomValues(new Uint8Array(16));

  // Encrypt with RescueCipher
  const cipher = new RescueCipher(sharedSecret);
  const ciphertext = cipher.encrypt(plaintextBigInts, nonce);

  // Flatten and preserve shape for reconstruction
  const shape = ciphertext.map(chunk => chunk.length);
  const flatCiphertext: number[] = ciphertext.flat();
  const ciphertextStrings = flatCiphertext.map(num => String(num));

  const serialized = {
    data: ciphertextStrings,
    shape: shape
  };

  const ciphertextJson = JSON.stringify(serialized);
  const ciphertextBase64 = Buffer.from(ciphertextJson).toString('base64');

  return {
    ciphertext: ciphertextBase64,
    nonce: Buffer.from(nonce).toString('base64'),
    publicKey: Buffer.from(publicKey).toString('base64'),
    ephemeralPrivateKey: Buffer.from(privateKey).toString('base64'),
  };
}

/**
 * Decrypt a response from TEE
 *
 * @param encryptedData - The encrypted response from TEE
 * @param clientPrivateKey - The ephemeral private key (optional, uses session key)
 */
export async function decrypt(
  encryptedData: EncryptedData,
  clientPrivateKey?: string
): Promise<string> {
  // Decode the encrypted data
  const ciphertextJson = Buffer.from(encryptedData.ciphertext, 'base64').toString('utf8');
  const parsed = JSON.parse(ciphertextJson) as { data: string[]; shape: number[] };

  // Reconstruct the 2D array
  const flatData = parsed.data.map((str: string) => Number(str));
  const shape = parsed.shape;

  const ciphertext: number[][] = [];
  let offset = 0;
  for (const chunkSize of shape) {
    ciphertext.push(flatData.slice(offset, offset + chunkSize));
    offset += chunkSize;
  }

  const nonce = Buffer.from(encryptedData.nonce, 'base64');
  const teePublicKey = Buffer.from(encryptedData.publicKey, 'base64');

  // Get private key
  let privateKey: Uint8Array;
  if (clientPrivateKey) {
    privateKey = new Uint8Array(Buffer.from(clientPrivateKey, 'base64'));
  } else if (encryptedData.ephemeralPrivateKey) {
    privateKey = new Uint8Array(Buffer.from(encryptedData.ephemeralPrivateKey, 'base64'));
  } else {
    const session = getSessionKeypair();
    privateKey = session.privateKey;
  }

  // Recreate shared secret
  const sharedSecret = x25519.getSharedSecret(privateKey, teePublicKey);

  // Decrypt with RescueCipher
  const cipher = new RescueCipher(sharedSecret);
  const decryptedBigInts = cipher.decrypt(ciphertext, nonce);

  // Decode by the version the TEE tagged its response with. Packed responses
  // (31 bytes/element) must be unpacked; legacy 1.0 responses are 1 byte each.
  // Falling back to '1.0' keeps us compatible with a not-yet-upgraded TEE.
  const decryptedBytes =
    encryptedData.version === ENCRYPTION_VERSION
      ? unpackBytes(decryptedBigInts)
      : new Uint8Array(decryptedBigInts.map(Number));
  const decryptedText = new TextDecoder().decode(decryptedBytes);

  // Parse response object
  try {
    const responseObj = JSON.parse(decryptedText) as { response?: string; message?: string };
    return responseObj.response || responseObj.message || decryptedText;
  } catch {
    return decryptedText;
  }
}

/**
 * Package encrypted data for TEE transmission
 */
export function packageForTEE(encryptedData: EncryptedData): string {
  return JSON.stringify({
    ciphertext: encryptedData.ciphertext,
    nonce: encryptedData.nonce,
    publicKey: encryptedData.publicKey,
    algorithm: 'Arcium-RescueCipher',
    version: ENCRYPTION_VERSION,
  });
}

/**
 * Clear session keypair (for logout/cleanup)
 */
export function clearSession(): void {
  sessionKeypair = null;
  cachedTeePublicKeys.clear();
}
