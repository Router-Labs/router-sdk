/**
 * SolRouter SDK - Arcium Encryption
 *
 * Handles client-side encryption using Arcium's RescueCipher.
 * No wallet signatures required - uses ephemeral X25519 key exchange.
 */

import { RescueCipher, x25519 } from '@arcium-hq/client';
import type { EncryptedData } from './types.js';

// Session keypair (generated once per SDK instance)
let sessionKeypair: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;

// Cached TEE public key
let cachedTeePublicKey: Uint8Array | null = null;

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

/**
 * Fetch TEE public key from server
 */
export async function fetchTeePublicKey(baseUrl: string): Promise<Uint8Array> {
  if (cachedTeePublicKey) {
    return cachedTeePublicKey;
  }

  try {
    const response = await fetch(`${baseUrl}/tee/public-key`);
    if (response.ok) {
      const data = await response.json() as { publicKey: string };
      cachedTeePublicKey = Buffer.from(data.publicKey, 'base64');
      return cachedTeePublicKey;
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback to dev TEE key
  const TEE_PRIVATE_KEY_TEMP = new Uint8Array(32).fill(42);
  cachedTeePublicKey = x25519.getPublicKey(TEE_PRIVATE_KEY_TEMP);
  return cachedTeePublicKey;
}

/**
 * Encrypt a message using Arcium's RescueCipher
 *
 * @param message - The plaintext message to encrypt
 * @param baseUrl - API base URL (for fetching TEE public key)
 * @returns Encrypted data bundle
 */
export async function encrypt(message: string, baseUrl: string): Promise<EncryptedData> {
  // Get session keypair
  const { privateKey, publicKey } = getSessionKeypair();

  // Get TEE public key
  const teePublicKey = await fetchTeePublicKey(baseUrl);

  // Convert message to BigInt array
  const messageBytes = new TextEncoder().encode(message);
  const plaintextBigInts = Array.from(messageBytes).map(BigInt);

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

  // Convert back to string
  const decryptedBytes = new Uint8Array(decryptedBigInts.map(Number));
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
    version: '1.0',
  });
}

/**
 * Clear session keypair (for logout/cleanup)
 */
export function clearSession(): void {
  sessionKeypair = null;
  cachedTeePublicKey = null;
}
