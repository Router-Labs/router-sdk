/**
 * SolRouter SDK Connection Test
 *
 * Use this script to verify your API key and test SDK functionality.
 *
 * Usage:
 *   SOLROUTER_API_KEY=sk_solrouter_xxx npx ts-node examples/test-connection.ts
 *
 * Or set environment variables:
 *   export SOLROUTER_API_KEY=sk_solrouter_xxx
 *   export SOLROUTER_BASE_URL=https://your-server.com (optional)
 */

import { SolRouter } from '@solrouter/sdk';

// Configuration from environment
const API_KEY = process.env.SOLROUTER_API_KEY;
const BASE_URL = process.env.SOLROUTER_BASE_URL || 'https://solrouter-obb4.onrender.com';

if (!API_KEY) {
  console.error('Error: SOLROUTER_API_KEY environment variable is required');
  console.error('Usage: SOLROUTER_API_KEY=sk_solrouter_xxx npx ts-node examples/test-connection.ts');
  process.exit(1);
}

const client = new SolRouter({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
  encrypted: true,
});

// Terminal colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

async function testApiKey(): Promise<boolean> {
  console.log(colors.cyan + '\n[1/3] Testing API Key...' + colors.reset);

  try {
    const balance = await client.getBalance();
    console.log(colors.green + '  ✓ API key is valid' + colors.reset);
    console.log(colors.dim + `  Balance: ${balance.balanceFormatted}` + colors.reset);
    return true;
  } catch (error: any) {
    console.log(colors.red + '  ✗ API key is invalid or expired' + colors.reset);
    console.log(colors.dim + `  Error: ${error.message}` + colors.reset);
    return false;
  }
}

async function testEncryptedChat(): Promise<boolean> {
  console.log(colors.cyan + '\n[2/3] Testing Encrypted Chat...' + colors.reset);

  try {
    const response = await client.chat('What is 2 + 2? Reply with just the number.', {
      model: 'gpt-oss-20b',
      encrypted: true,
    });
    console.log(colors.green + '  ✓ Encrypted chat working' + colors.reset);
    console.log(colors.dim + `  Response: "${response.message}"` + colors.reset);
    console.log(colors.dim + `  Encrypted: ${response.encrypted}` + colors.reset);
    return true;
  } catch (error: any) {
    console.log(colors.red + '  ✗ Encrypted chat failed' + colors.reset);
    console.log(colors.dim + `  Error: ${error.message}` + colors.reset);
    return false;
  }
}

async function testLiveSearch(): Promise<boolean> {
  console.log(colors.cyan + '\n[3/3] Testing Live Search...' + colors.reset);

  try {
    const response = await client.chat('What is the current price of Bitcoin? Be brief.', {
      model: 'gpt-oss-20b',
      encrypted: true,
      useLiveSearch: true,
    });
    console.log(colors.green + '  ✓ Live search working' + colors.reset);
    console.log(colors.dim + `  Response: "${response.message}"` + colors.reset);
    return true;
  } catch (error: any) {
    console.log(colors.red + '  ✗ Live search failed' + colors.reset);
    console.log(colors.dim + `  Error: ${error.message}` + colors.reset);
    return false;
  }
}

async function main() {
  console.log('\n' + '='.repeat(50));
  console.log(colors.cyan + '  SolRouter SDK Connection Test' + colors.reset);
  console.log('='.repeat(50));
  console.log(colors.dim + `Base URL: ${BASE_URL}` + colors.reset);
  console.log(colors.dim + `API Key: ${API_KEY.substring(0, 20)}****` + colors.reset);

  const results = {
    apiKey: await testApiKey(),
    encryptedChat: false,
    liveSearch: false,
  };

  // Only continue if API key is valid
  if (results.apiKey) {
    results.encryptedChat = await testEncryptedChat();
    results.liveSearch = await testLiveSearch();
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(colors.cyan + '  Results' + colors.reset);
  console.log('='.repeat(50));

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  console.log(`  API Key:        ${results.apiKey ? colors.green + '✓' : colors.red + '✗'}` + colors.reset);
  console.log(`  Encrypted Chat: ${results.encryptedChat ? colors.green + '✓' : colors.red + '✗'}` + colors.reset);
  console.log(`  Live Search:    ${results.liveSearch ? colors.green + '✓' : colors.red + '✗'}` + colors.reset);
  console.log();
  console.log(`  ${passed}/${total} tests passed`);
  console.log();

  // Cleanup
  client.clearSession();

  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);
