/**
 * Pure utility functions for AutoPost Pro.
 * Shared by the Express backend and unit-tested independently.
 */

export const SUPPORTED_GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

export type SupportedGeminiModel = (typeof SUPPORTED_GEMINI_MODELS)[number];

export const DEFAULT_GEMINI_MODEL: SupportedGeminiModel = 'gemini-3.1-flash-lite';

/**
 * Resolves a requested model ID to an active, supported Gemini model.
 * Maps deprecated or unknown model names cleanly to the default model.
 */
export function resolveGeminiModel(requested?: string | null): SupportedGeminiModel {
  if (!requested || typeof requested !== 'string') {
    return DEFAULT_GEMINI_MODEL;
  }
  const normalized = requested.trim().toLowerCase();
  if (normalized === 'gemini-3.1-flash-lite') {
    return 'gemini-3.1-flash-lite';
  }
  if (normalized === 'gemini-4-hydrogen') {
    return 'gemini-4-hydrogen';
  }
  return DEFAULT_GEMINI_MODEL;
}

/**
 * Resolves spintax patterns like `{Hello|Hi|Hey}` including nested braces
 * with a hard iteration cap to avoid infinite loops on malformed input.
 */
export function spinContent(text: string, rng: () => number = Math.random): string {
  if (!text) return '';
  let result = text;
  const maxPasses = 10;
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = result.replace(/\{([^{}]+)\}/g, (_match, inner: string) => {
      const options = inner.split('|');
      const idx = Math.min(options.length - 1, Math.floor(rng() * options.length));
      return options[idx] ?? '';
    });
    if (next === result) break;
    result = next;
  }
  return result;
}

const BULLET_LEAD_EMOJI_PATTERN =
  '(?:✨|⚡|🔥|💥|🎯|✅|✔️|☑️|👉|📌|📍|📞|☎️|📲|💬|💰|💵|🎁|🎉|🏷️|⭐|🌟|💎|🚀|🛡️|🎓|♻️|💳|🖥️|💻|📱|⏰|🕒|🏪|🏠|🚚|📦|❤️|🔹|🔸|▪️|•|📢|🔔|💡|🏆)';

const PRICING_EMOJI_RE = /^(?:💰|💵|🎁|🏷️|💳|🎓|♻️)/u;
const CONTACT_EMOJI_RE = /^(?:📍|📌|👉|🏪|🏠|📞|☎️|📲|⏰|🕒)/u;

/**
 * Normalizes line breaks, splits dense inline emoji bullets & jammed hashtags,
 * and adds clean visual paragraph spacing optimized for Facebook feeds.
 */
export function formatSalesContent(text: string): string {
  if (!text) return '';

  let normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ');

  // 1. Separate hashtags jammed directly onto preceding text (e.g. "0355936679#CellphoneS")
  normalized = normalized.replace(/([^\s#\n])(#[\p{L}\p{N}_]+)/gu, '$1\n\n$2');

  // 2. Break pipe separators followed by a bullet emoji (e.g. "| 💳 Hỗ trợ..." -> "\n💳 Hỗ trợ...")
  //    while keeping inline text pipes like "Hotline: 024... | Zalo: 035..." intact.
  const pipeBulletRe = new RegExp(`\\s*\\|\\s*(?=${BULLET_LEAD_EMOJI_PATTERN}\\s+\\S)`, 'gu');
  normalized = normalized.replace(pipeBulletRe, '\n');

  // 3. Break mid-line bullet emojis that start a new point (emoji followed by space + text).
  //    Preserves trailing decorative emojis at line ends (e.g. "ĐẲNG CẤP KHÁC BIỆT! 💻✨").
  const inlineBulletRe = new RegExp(
    `([^\\n])\\s*(${BULLET_LEAD_EMOJI_PATTERN}(?=\\s+[^\\s\\n]))`,
    'gu',
  );
  normalized = normalized
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || /^#[\p{L}\p{N}_]/u.test(trimmed)) return trimmed;
      return trimmed.replace(inlineBulletRe, '$1\n$2');
    })
    .join('\n');

  // 4. Clean per-line whitespace and insert clean breathing room between logical sections
  const rawLines = normalized.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').trim());
  const out: string[] = [];

  const getSectionType = (line: string): 'empty' | 'hashtag' | 'contact' | 'pricing' | 'body' => {
    if (!line) return 'empty';
    if (/^#[\p{L}\p{N}_]/u.test(line)) return 'hashtag';
    if (CONTACT_EMOJI_RE.test(line)) return 'contact';
    if (PRICING_EMOJI_RE.test(line)) return 'pricing';
    return 'body';
  };

  let prevNonEmptyType: 'headline' | 'hashtag' | 'contact' | 'pricing' | 'body' | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }
      continue;
    }

    const currentType: 'headline' | 'empty' | 'hashtag' | 'contact' | 'pricing' | 'body' =
      prevNonEmptyType === null ? 'headline' : getSectionType(line);
    const hasLeadingBlank = out.length > 0 && out[out.length - 1] === '';

    if (prevNonEmptyType !== null && !hasLeadingBlank) {
      const shouldAddBlank =
        prevNonEmptyType === 'headline' ||
        currentType === 'hashtag' ||
        (currentType === 'pricing' && prevNonEmptyType !== 'pricing') ||
        (currentType === 'contact' && prevNonEmptyType !== 'contact');

      if (shouldAddBlank) {
        out.push('');
      }
    }

    out.push(line);
    prevNonEmptyType = currentType === 'empty' ? prevNonEmptyType : currentType;
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cleans AI-rewritten post text: removes accidental preambles, self-check lines,
 * markdown fences/asterisks, template placeholders, and outer braces.
 */
export function cleanAiRewriteOutput(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';

  let allLines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  // 1. Strip everything after the last hashtag-only/trailing hashtag line if trailing meta chatter exists
  let lastHashIdx = -1;
  for (let i = allLines.length - 1; i >= 0; i--) {
    if (/^#[\p{L}\p{N}_]/u.test(allLines[i])) {
      lastHashIdx = i;
      break;
    }
  }
  if (lastHashIdx !== -1 && lastHashIdx < allLines.length - 1) {
    const trailingText = allLines
      .slice(lastHashIdx + 1)
      .join(' ')
      .replace(/^[}\s\-*]+/, '')
      .trim();
    if (!trailingText || /^(note|check|total|wait|final|ghi chú|lưu ý)/i.test(trailingText)) {
      allLines = allLines.slice(0, lastHashIdx + 1);
    }
  }

  // 2. Strip preamble headers like "Final version:", "Bài viết:", "Dưới đây là:"
  let cutTopIdx = -1;
  for (let i = 0; i < Math.min(allLines.length, 6); i++) {
    const lower = allLines[i].toLowerCase();
    if (
      /^(final version|final draft|final attempt|text:|output:|bài viết:|here is|dưới đây là|let's try this|revised)/.test(
        lower,
      ) ||
      lower.includes('construction:')
    ) {
      cutTopIdx = i;
    }
  }
  if (cutTopIdx !== -1) {
    allLines = allLines.slice(cutTopIdx + 1);
  }

  // 3. Remove meta/check lines and markdown fences
  const badLineRegex =
    /^(emoji count|constraint check|final check|one more check|original content|target audience|tone requested|word count|word check|```)/i;
  const bannedStartRegex = /^(Total|Wait|Perfect|I will|I should|Insight|Checklist)\b/i;
  const selfCheckRegex = /\?\s*(Yes|No)\b/i;
  const draftLabelRegex = /^(Headline|Body|Bullet points|CTA|Hashtags):\s*/i;

  let lines = allLines
    .filter((l) => !badLineRegex.test(l))
    .filter((l) => !bannedStartRegex.test(l))
    .filter((l) => !selfCheckRegex.test(l))
    .map((l) =>
      l
        .replace(draftLabelRegex, '')
        .replace(/\{CONTENT\}/gi, '')
        .replace(/```[a-z]*$/gi, '')
        .replace(/[`*]/g, '')
        .trim(),
    );

  // Strip outer wrapping braces from template echoes
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  if (lines.length > 0 && lines[0].startsWith('{')) {
    lines[0] = lines[0].replace(/^\{+\s*/, '');
  }
  if (lines.length > 0 && lines[lines.length - 1].endsWith('}')) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\}+$/, '');
  }

  return formatSalesContent(lines.join('\n'));
}

/**
 * Clamps posting delay min/max safely so empty inputs or NaN never break timers.
 */
export function clampDelayRange(
  rawMin: number | string,
  rawMax: number | string,
): { min: number; max: number } {
  const parsedMin = Number(rawMin);
  const parsedMax = Number(rawMax);
  const min = Number.isFinite(parsedMin) && parsedMin >= 5 ? Math.floor(parsedMin) : 10;
  const max =
    Number.isFinite(parsedMax) && parsedMax > min ? Math.floor(parsedMax) : min + 30;
  return { min, max };
}

/**
 * Calculates a new subscription expiry ISO string.
 * Extends from existing future expiry when renewing an active plan.
 */
export function calculateSubscriptionExpiry(
  currentExpiresAt: string | null | undefined,
  rawMonths: number | string,
  now: Date = new Date(),
): string {
  const parsed = parseInt(String(rawMonths), 10);
  const months = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 36) : 1;

  let baseDate = new Date(now.getTime());
  if (currentExpiresAt) {
    const existing = new Date(currentExpiresAt);
    if (!Number.isNaN(existing.getTime()) && existing.getTime() > now.getTime()) {
      baseDate = existing;
    }
  }

  const next = new Date(baseDate.getTime());
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
}

/**
 * Validates whether a Facebook post URL is shareable.
 */
export function validateFacebookShareUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('/photo/') || trimmed.endsWith('/photo')) return false;
  return /^https?:\/\/(www\.|m\.|mbasic\.|web\.)?facebook\.com\/.+/i.test(trimmed);
}

/**
 * Normalizes group IDs consistently across string and numeric payloads.
 */
export function normalizeGroupId(id: string | number | null | undefined): string {
  if (id === null || id === undefined) return '';
  return String(id).trim();
}

/**
 * Builds a VietQR preview URL from bank settings.
 */
export function buildVietQrUrl(params: {
  bankName?: string;
  bankNo?: string;
  bankUser?: string;
  qrTemplate?: string;
  amount: number;
  addInfo: string;
}): string {
  const bank = (params.bankName || 'mbbank').trim() || 'mbbank';
  const accountNo = (params.bankNo || '').trim();
  const base =
    params.qrTemplate && params.qrTemplate.trim()
      ? params.qrTemplate.trim()
      : `https://img.vietqr.io/image/${bank}-${accountNo}-compact.png`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}amount=${Math.max(0, Math.round(params.amount))}&addInfo=${encodeURIComponent(
    params.addInfo,
  )}&accountName=${encodeURIComponent(params.bankUser || 'AUTOPOST PRO')}`;
}
