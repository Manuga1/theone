// Serverless entry: the Express app is the request handler (Vercel's Node launcher calls it with the raw req/res).
import { createApp } from './index';

const app = createApp();
export default app;
