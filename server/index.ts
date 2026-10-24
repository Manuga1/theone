import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { persona } from './middleware/persona';
import { noIdentity } from './middleware/noIdentity';
import { participantRouter } from './routes/participant';
import { buyerRouter } from './routes/buyer';
import { demoRouter } from './routes/demo';
import { ROOT } from './db/paths';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
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

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { status?: number; message?: string; code?: string };
    const status = e.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: e.message ?? 'internal error', code: e.code });
  });
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
}
