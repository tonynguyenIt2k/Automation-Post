import { getSettings, updateSettings } from './_store.js';
import { getRequestBody, type ApiRequest, type ApiResponse } from './_types.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(getSettings());
  }
  if (req.method === 'PUT') {
    const updated = updateSettings(getRequestBody(req));
    return res.status(200).json(updated);
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
