import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ApiRequest, ApiResponse } from './_types.js';

export const EXTENSION_VERSION = '3.8';
export const EXTENSION_FILENAME = `fb-tool-ext-v${EXTENSION_VERSION}.zip`;

function getQueryParamLocal(req: ApiRequest, key: string): string {
  const raw = req.query?.[key];
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  if (typeof raw === 'string') return raw.trim();
  return '';
}

export function isValidZipBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 22) return false;
  // ZIP Local File Header signature: PK\x03\x04
  const hasLocalHeader =
    buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (!hasLocalHeader) return false;
  // End of Central Directory signature: PK\x05\x06 within the trailing 64KB
  const searchStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      return true;
    }
  }
  return false;
}

export function readExtensionZipBuffer(): Buffer | null {
  const cwd = process.cwd();
  let moduleDir = cwd;
  try {
    moduleDir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    moduleDir = cwd;
  }

  const candidates = [
    path.resolve(cwd, 'web/ext-download/fb-tool-ext.zip'),
    path.resolve(cwd, 'dist/ext-download/fb-tool-ext.zip'),
    path.resolve(cwd, 'ext-download/fb-tool-ext.zip'),
    path.resolve(moduleDir, '../web/ext-download/fb-tool-ext.zip'),
    path.resolve(moduleDir, '../dist/ext-download/fb-tool-ext.zip'),
    path.resolve(moduleDir, '../ext-download/fb-tool-ext.zip'),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        if (isValidZipBuffer(buf)) {
          return buf;
        }
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

export default function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    const buf = readExtensionZipBuffer();
    if (!buf) {
      return res.status(404).json({
        ok: false,
        error: 'Không tìm thấy gói Extension hợp lệ trên máy chủ.',
      });
    }

    const format = getQueryParamLocal(req, 'format').toLowerCase();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (format === 'base64' || format === 'json') {
      return res.status(200).json({
        ok: true,
        version: EXTENSION_VERSION,
        filename: EXTENSION_FILENAME,
        mimeType: 'application/zip',
        size: buf.length,
        base64: buf.toString('base64'),
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${EXTENSION_FILENAME}"`);
    res.setHeader('Content-Length', String(buf.length));
    return res.status(200).end(buf);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return res.status(500).json({ ok: false, error: message });
  }
}
