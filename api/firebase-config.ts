import { getFirebaseEnvConfig } from './_store';
import type { ApiRequest, ApiResponse } from './_types';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const config = getFirebaseEnvConfig();
  return res.status(200).json({
    configured: Boolean(config),
    config,
  });
}
