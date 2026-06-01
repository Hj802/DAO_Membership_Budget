import { existsSync } from 'node:fs';
import { config } from 'dotenv';

config({ path: existsSync('.env') ? '.env' : '.env.example' });

const requiredKeys = ['NODE_ENV', 'APP_ENV', 'VITE_CHAIN_ID'];
const missingKeys = requiredKeys.filter((key) => !process.env[key]);

if (missingKeys.length > 0) {
  console.error(`Missing required environment variables: ${missingKeys.join(', ')}`);
  process.exit(1);
}

if (process.env.VITE_CHAIN_ID !== '11155111') {
  console.error('VITE_CHAIN_ID must be 11155111 for the Sepolia MVP environment.');
  process.exit(1);
}

console.log('Environment shape is valid for local development.');
