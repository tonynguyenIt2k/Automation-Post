import { rewritePostWithGemini } from '../_gemini.js';
import { getRequestBody, type ApiRequest, type ApiResponse } from '../_types.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const body = getRequestBody(req);
    const result = await rewritePostWithGemini({
      content: body.content,
      customPrompt: body.customPrompt,
      model: body.model,
      groupName: body.groupName,
      variationIndex: body.variationIndex,
      totalVariations: body.totalVariations,
      writingStyle: body.writingStyle,
      avoidOpenings: body.avoidOpenings,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(200).json({
      text: result.text,
      rewritten: result.rewritten,
      model: result.model,
      angleId: result.angleId,
      angleLabel: result.angleLabel,
      writingStyle: result.writingStyle,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi không xác định khi gọi Gemini AI';
    console.error('[Vercel Gemini Rewrite Error]', message);
    return res.status(500).json({ error: message });
  }
}
