import { existsSync, readFileSync } from 'node:fs';

const envPath = existsSync('.env') ? '.env' : '.env.example';
const envText = readFileSync(envPath, 'utf8');
const parsedEnv = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
    }),
);

const env = { ...parsedEnv, ...process.env };
const requiredKeys = ['NODE_ENV', 'APP_ENV', 'VITE_CHAIN_ID'];
const missingKeys = requiredKeys.filter((key) => !env[key]);

if (missingKeys.length > 0) {
  console.error(`Missing required environment variables: ${missingKeys.join(', ')}`);
  process.exit(1);
}

if (env.VITE_CHAIN_ID !== '11155111') {
  console.error('VITE_CHAIN_ID must be 11155111 for the Sepolia MVP environment.');
  process.exit(1);
}

console.log('Environment shape is valid for local development.');
