import { listUsers } from '../_store';
import type { ApiRequest, ApiResponse } from '../_types';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  return res.status(200).json(listUsers());
}
