import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { persona } from './middleware/persona';
import { noIdentity } from './middleware/noIdentity';
import { participantRouter } from './routes/participant';
import { buyerRouter } from './routes/buyer';
import { demoRouter } from './routes/demo';
import { ROOT } from './db/paths';
import { openGraph } from './db/graph';
import { requestScope } from './db/driver';

export function createApp(): express.Express {
  const app = express();
  // the Apple Health export is posted as text or { xml } and may be large (≤ 25 MB); body parsers skip a body already parsed
  app.use('/api/participant/import/apple-health', express.json({ limit: '25mb' }), express.text({ type: ['text/xml', 'application/xml', 'text/plain'], limit: '25mb' }));
  app.use(express.json({ limit: '2mb' }));
  // the local PGlite database opens asynchronously; Supabase (DATABASE_URL / POSTGRES_URL) connects lazily
  app.use('/api', async (_req, _res, next) => { await openGraph().then(() => requestScope.run({}, next), next); });
  app.use('/api', persona);
  app.use('/api/participant', participantRouter);
  app.use('/api/buyer', noIdentity, buyerRouter);
  app.use('/api', demoRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  const dist = path.join(ROOT, 'dist', 'client');
  if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*path', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

/**
 * The one line written for a failed request: method, path (no query string), status and the error message. Never the
 * request body, headers, query string or the error object itself (body-parser errors carry the raw body).
 */
export function errorLogLine(req: Pick<express.Request, 'method' | 'originalUrl'>, status: number, message: string): string {
  const path = (req.originalUrl ?? '').split('?')[0];
  const msg = message.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `[api] ${req.method} ${path} ${status} ${msg}`;
}

export function errorHandler(err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction): void {
  const e = (err ?? {}) as { status?: number; message?: string; code?: string };
  const status = typeof e.status === 'number' && e.status >= 400 && e.status <= 599 ? e.status : 500;
  const message = typeof e.message === 'string' && e.message ? e.message : 'internal error';
  if (status >= 500) console.error(errorLogLine(req, status, message));
  res.status(status).json({ error: message, code: e.code });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
}
