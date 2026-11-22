import { syncUser } from '../_store.js';
import { getRequestBody, type ApiRequest, type ApiResponse } from '../_types.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const merged = syncUser(getRequestBody(req));
  if (!merged) {
    return res.status(400).json({ error: 'Missing user id' });
  }
  return res.status(200).json(merged);
}
