import 'dotenv/config';
import { createServer } from 'node:http';
import { handleRequest } from './app';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 4000);

const server = createServer(async (incomingMessage, serverResponse) => {
  const chunks: Uint8Array[] = [];

  for await (const chunk of incomingMessage) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${host}:${port}${incomingMessage.url ?? '/'}`, {
    method: incomingMessage.method,
    headers: incomingMessage.headers as HeadersInit,
    body,
  });
  const response = await handleRequest(request);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  serverResponse.writeHead(response.status, responseHeaders);
  serverResponse.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
