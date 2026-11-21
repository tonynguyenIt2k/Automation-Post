import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createGeminiClient,
  rewritePostWithGemini,
  testGeminiConnection,
} from './api/_gemini.ts';
import {
  approveUserSubscription,
  getFirebaseEnvConfig,
  getSettings,
  getUserById,
  listUsers,
  rejectUserSubscription,
  syncUser,
  updateAdminUser,
  updateSettings,
} from './api/_store.ts';
import {
  EXTENSION_FILENAME,
  EXTENSION_VERSION,
  readExtensionZipBuffer,
} from './api/extension-download.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const WEB_DIR = path.resolve(__dirname, 'web');

const app = express();
app.use(express.json({ limit: '20mb' }));

// Health check & runtime capabilities
app.get('/api/health', (_req, res) => {
  const ai = createGeminiClient();
  const fb = getFirebaseEnvConfig();
  res.json({
    ok: true,
    geminiConfigured: Boolean(ai),
    firebaseConfigured: Boolean(fb),
    runtime: 'express',
    timestamp: new Date().toISOString(),
  });
});

// Firebase client config
app.get('/api/firebase-config', (_req, res) => {
  const config = getFirebaseEnvConfig();
  res.json({
    configured: Boolean(config),
    config,
  });
});

// Server-side Gemini rewrite endpoint (keeps API key strictly on server)
app.post('/api/gemini/rewrite', async (req, res) => {
  try {
    const {
      content,
      customPrompt,
      model,
      groupName,
      variationIndex,
      totalVariations,
      writingStyle,
      avoidOpenings,
    } = req.body ?? {};
    const result = await rewritePostWithGemini({
      content,
      customPrompt,
      model,
      groupName,
      variationIndex,
      totalVariations,
      writingStyle,
      avoidOpenings,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({
      text: result.text,
      rewritten: result.rewritten,
      model: result.model,
      angleId: result.angleId,
      angleLabel: result.angleLabel,
      writingStyle: result.writingStyle,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi không xác định khi gọi Gemini AI';
    console.error('[Gemini Rewrite Error]', message);
    return res.status(500).json({ error: message });
  }
});

// Server-side Gemini connectivity test
app.post('/api/gemini/test', async (req, res) => {
  try {
    const result = await testGeminiConnection(req.body?.model);
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
    return res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Không thể kết nối Gemini AI';
    console.error('[Gemini Test Error]', message);
    return res.status(500).json({ ok: false, error: message });
  }
});

// System settings API
app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  res.json(updateSettings((req.body ?? {}) as Record<string, unknown>));
});

// User sync API
app.get('/api/users/:id', (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json(user);
});

app.post('/api/users/sync', (req, res) => {
  const merged = syncUser((req.body ?? {}) as Record<string, unknown>);
  if (!merged) {
    return res.status(400).json({ error: 'Missing user id' });
  }
  return res.json(merged);
});

// Admin Users API
app.get('/api/admin/users', (_req, res) => {
  res.json(listUsers());
});

app.post('/api/admin/users/:id/approve', (req, res) => {
  const user = approveUserSubscription(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  return res.json(user);
});

app.post('/api/admin/users/:id/reject', (req, res) => {
  const user = rejectUserSubscription(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  return res.json(user);
});

app.put('/api/admin/users/:id', (req, res) => {
  const user = updateAdminUser(req.params.id, (req.body ?? {}) as Record<string, unknown>);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
  return res.json(user);
});

// Multi-page clean URL routes (mirrors Vercel cleanUrls: true)
app.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.get(['/share', '/share.html'], (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'share.html'));
});

app.get(['/pricing', '/pricing.html'], (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'pricing.html'));
});

app.get(['/login', '/login.html'], (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'login.html'));
});

app.get(['/admin', '/admin.html'], (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'admin.html'));
});

// Verified Extension ZIP download API (supports binary & ?format=base64 JSON fallback)
app.get('/api/extension-download', (req, res) => {
  const buf = readExtensionZipBuffer();
  if (!buf) {
    return res.status(404).json({
      ok: false,
      error: 'Không tìm thấy gói Extension hợp lệ trên máy chủ.',
    });
  }

  const format = String(req.query?.format ?? '').trim().toLowerCase();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (format === 'base64' || format === 'json') {
    return res.json({
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
  return res.end(buf);
});

// Explicit static extension ZIP route with strict binary headers (never falls back to HTML)
app.get('/ext-download/fb-tool-ext.zip', (_req, res) => {
  const buf = readExtensionZipBuffer();
  if (!buf) {
    return res.status(404).json({
      ok: false,
      error: 'Không tìm thấy gói Extension hợp lệ trên máy chủ.',
    });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${EXTENSION_FILENAME}"`);
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.end(buf);
});

// Static assets (app.jsx, style.css, assets/, ext-download/)
app.use(express.static(WEB_DIR));

// Never return index.html for missing API or extension binary paths
app.use(['/api', '/ext-download'], (_req, res) => {
  return res.status(404).json({ error: 'Not Found' });
});

// Fallback for any unknown client route
app.use((_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AutoPost Pro server running at http://0.0.0.0:${PORT}`);
});
