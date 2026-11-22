import { testGeminiConnection } from '../_gemini.js';
import { getRequestBody, type ApiRequest, type ApiResponse } from '../_types.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  try {
    const body = getRequestBody(req);
    const result = await testGeminiConnection(body.model);
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Không thể kết nối Gemini AI';
    console.error('[Vercel Gemini Test Error]', message);
    return res.status(500).json({ ok: false, error: message });
  }
}
