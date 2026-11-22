import { approveUserSubscription } from '../../../_store.js';
import { getQueryParam, type ApiRequest, type ApiResponse } from '../../../_types.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const id = getQueryParam(req, 'id');
  const user = id ? approveUserSubscription(id) : null;
  if (!user) {
    return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  }
  return res.status(200).json(user);
}
