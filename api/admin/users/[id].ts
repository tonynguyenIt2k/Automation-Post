import { updateAdminUser } from '../../_store.js';
import { getQueryParam, getRequestBody, type ApiRequest, type ApiResponse } from '../../_types.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const id = getQueryParam(req, 'id');
  const user = id ? updateAdminUser(id, getRequestBody(req)) : null;
  if (!user) {
    return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  }
  return res.status(200).json(user);
}
