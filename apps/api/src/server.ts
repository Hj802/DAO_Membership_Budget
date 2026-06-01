import 'dotenv/config';
import { createApp } from './app';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 4000);

createApp().listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
