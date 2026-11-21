import { rejectUserSubscription } from '../../../_store';
import { getQueryParam, type ApiRequest, type ApiResponse } from '../../../_types';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const id = getQueryParam(req, 'id');
  const user = id ? rejectUserSubscription(id) : null;
  if (!user) {
    return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  }
  return res.status(200).json(user);
}
