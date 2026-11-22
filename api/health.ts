import { createGeminiClient } from './_gemini.js';
import { getFirebaseEnvConfig } from './_store.js';
import type { ApiRequest, ApiResponse } from './_types.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const ai = createGeminiClient();
  const fb = getFirebaseEnvConfig();
  return res.status(200).json({
    ok: true,
    geminiConfigured: Boolean(ai),
    firebaseConfigured: Boolean(fb),
    runtime: 'vercel-serverless',
    timestamp: new Date().toISOString(),
  });
}
