export interface ApiRequest {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse | void;
  setHeader(name: string, value: string): void;
  end(body?: string | Uint8Array): void;
}

export function getRequestBody(req: ApiRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return {};
}

export function getQueryParam(req: ApiRequest, key: string): string {
  const raw = req.query?.[key];
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  return typeof raw === 'string' ? raw.trim() : '';
}
