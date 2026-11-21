import { getUserById } from '../_store';
import { getQueryParam, type ApiRequest, type ApiResponse } from '../_types';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const id = getQueryParam(req, 'id');
  const user = id ? getUserById(id) : undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.status(200).json(user);
}
