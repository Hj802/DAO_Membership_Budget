import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prismaCli = path.resolve(here, '../../../node_modules/prisma/build/index.js');
const schemaPath = path.resolve(here, '../prisma/schema.prisma');

const env = { ...process.env };

if (process.platform === 'win32') {
  env.PRISMA_SCHEMA_ENGINE_BINARY = path.resolve(
    here,
    '../../../node_modules/@prisma/engines/schema-engine-windows.exe',
  );
  env.PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING = '1';
}

const result = spawnSync(process.execPath, [prismaCli, 'validate', '--schema', schemaPath], {
  env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
