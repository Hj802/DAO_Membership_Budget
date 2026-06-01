import cors from 'cors';
import express from 'express';
import { SEPOLIA_CHAIN_ID } from '@dao-budget/shared';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      service: 'dao-budget-api',
      chainId: SEPOLIA_CHAIN_ID,
    });
  });

  return app;
}
