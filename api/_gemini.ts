import { GoogleGenAI, ThinkingLevel } from '@google/genai';

type SupportedGeminiModel = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
const DEFAULT_GEMINI_MODEL: SupportedGeminiModel = 'gemini-3.1-flash-lite';

function resolveGeminiModel(requested?: string | null): SupportedGeminiModel {
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

const BULLET_LEAD_EMOJI_PATTERN =
  '(?:✨|⚡|🔥|💥|🎯|✅|✔️|☑️|👉|📌|📍|📞|☎️|📲|💬|💰|💵|🎁|🎉|🏷️|⭐|🌟|💎|🚀|🛡️|🎓|♻️|💳|🖥️|💻|📱|⏰|🕒|🏪|🏠|🚚|📦|❤️|🔹|🔸|▪️|•|📢|🔔|💡|🏆)';
const PRICING_EMOJI_RE = /^(?:💰|💵|🎁|🏷️|💳|🎓|♻️)/u;
const CONTACT_EMOJI_RE = /^(?:📍|📌|👉|🏪|🏠|📞|☎️|📲|⏰|🕒)/u;

function formatSalesContent(text: string): string {
  if (!text) return '';
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u00A0/g, ' ');
  normalized = normalized.replace(/([^\s#\n])(#[\p{L}\p{N}_]+)/gu, '$1\n\n$2');
  const pipeBulletRe = new RegExp(`\\s*\\|\\s*(?=${BULLET_LEAD_EMOJI_PATTERN}\\s+\\S)`, 'gu');
  normalized = normalized.replace(pipeBulletRe, '\n');
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
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
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
      if (shouldAddBlank) out.push('');
    }
    out.push(line);
    prevNonEmptyType = currentType === 'empty' ? prevNonEmptyType : currentType;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanAiRewriteOutput(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';
  let allLines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((l) => l.trim());
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
  if (cutTopIdx !== -1) allLines = allLines.slice(cutTopIdx + 1);

  const badLineRegex =
    /^(emoji count|constraint check|final check|one more check|original content|target audience|tone requested|word count|word check|```)/i;
  const bannedStartRegex = /^(Total|Wait|Perfect|I will|I should|Insight|Checklist)\b/i;
  const selfCheckRegex = /\?\s*(Yes|No)\b/i;
  const draftLabelRegex = /^(Headline|Body|Bullet points|CTA|Hashtags):\s*/i;

  const lines = allLines
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

  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > 0 && lines[0].startsWith('{')) lines[0] = lines[0].replace(/^\{+\s*/, '');
  if (lines.length > 0 && lines[lines.length - 1].endsWith('}')) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\}+$/, '');
  }
  return formatSalesContent(lines.join('\n'));
}

export interface CopywritingAngle {
  id: string;
  label: string;
  instruction: string;
}

export const COPYWRITING_ANGLES: CopywritingAngle[] = [
  {
    id: 'hook_question',
    label: 'Câu hỏi gợi mở nhu cầu',
    instruction:
      'Mở đầu bằng một câu hỏi tự nhiên, đánh trúng nhu cầu thực tế của người đọc (ví dụ đang tìm sản phẩm/dịch vụ phù hợp hoặc muốn nâng cấp trải nghiệm), rồi dẫn mượt vào giá trị nổi bật của sản phẩm.',
  },
  {
    id: 'value_direct',
    label: 'Đi thẳng giá & đặc quyền',
    instruction:
      'Mở đầu trực diện, ấn tượng vào mức giá tốt hoặc quyền lợi nổi bật nhất (ưu đãi, trả góp, trợ giá nếu bài gốc có). Trình bày rành mạch để khách thấy ngay độ "đáng tiền" trong 3 giây đầu.',
  },
  {
    id: 'lifestyle_experience',
    label: 'Trải nghiệm thực tế',
    instruction:
      'Viết theo góc nhìn chia sẻ trải nghiệm sử dụng thực tế: cảm giác cầm nắm, sự tiện lợi khi làm việc/giải trí hằng ngày. Giọng văn chân thật, gần gũi như người dùng hài lòng giới thiệu lại.',
  },
  {
    id: 'expert_consult',
    label: 'Chuyên gia tư vấn chọn mua',
    instruction:
      'Viết với phong thái tư vấn viên am hiểu, đáng tin cậy: nêu rõ sản phẩm phù hợp với ai, điểm ăn tiền nhất là gì và vì sao nên chọn ngay thời điểm này.',
  },
  {
    id: 'problem_solution',
    label: 'Điểm đau → Giải pháp',
    instruction:
      'Mở đầu bằng một nỗi băn khoăn hoặc bất tiện quen thuộc của khách hàng, sau đó đưa sản phẩm trong bài gốc ra như giải pháp nâng cấp trọn vẹn và tiết kiệm thời gian.',
  },
  {
    id: 'community_share',
    label: 'Chia sẻ deal cho hội nhóm',
    instruction:
      'Viết theo giọng tự nhiên như một bài chia sẻ thông tin hữu ích cho anh chị em trong hội nhóm: thân thiện, không quá kiểu quảng cáo cứng nhắc, nhấn mạnh địa chỉ uy tín và sự hỗ trợ tận tâm.',
  },
  {
    id: 'smart_upgrade',
    label: 'Nâng cấp & tối ưu chi phí',
    instruction:
      'Tập trung làm nổi bật bài toán đầu tư thông minh: chất lượng vượt tầm giá, các chính sách hỗ trợ tài chính/thu cũ đổi mới/ưu đãi riêng (nếu bài gốc có) giúp sở hữu cực nhẹ nhàng.',
  },
  {
    id: 'visit_experience',
    label: 'Mời trải nghiệm trực tiếp',
    instruction:
      'Tạo cảm giác chuyên nghiệp, mời gọi khách ghé trực tiếp cửa hàng hoặc nhắn tin nhận tư vấn chi tiết. Nhấn mạnh sự an tâm khi mua sắm và tốc độ hỗ trợ nhanh gọn.',
  },
];

export const STORYTELLING_ANGLES: CopywritingAngle[] = [
  {
    id: 'warm_memory',
    label: 'Cảm xúc & ký ức gần gũi',
    instruction:
      'Giữ trọn mạch cảm xúc dịu nhẹ, hoài niệm và gần gũi như một dòng chia sẻ đời thường. Diễn đạt lại bằng câu chữ mới tự nhiên, chân thật, không mang giọng quảng cáo bán hàng.',
  },
  {
    id: 'small_detail',
    label: 'Chi tiết nhỏ tạo ấn tượng',
    instruction:
      'Làm nổi bật những chi tiết nhỏ tinh tế có trong bài gốc (như cảm giác cầm nắm, ánh nhìn, dấu ấn riêng quen thuộc) bằng cách kể mới mẻ, mềm mại và dễ đồng cảm.',
  },
  {
    id: 'everyday_story',
    label: 'Chuyện thường ngày tự nhiên',
    instruction:
      'Kể lại như một mẩu chuyện nhỏ đời thường vừa trải qua hôm nay, câu chữ giản dị, nhịp văn thoáng, giữ nguyên tinh thần và hình ảnh có trong bài gốc.',
  },
  {
    id: 'gentle_reflection',
    label: 'Góc nhìn tinh tế & sâu lắng',
    instruction:
      'Mở đầu bằng một cảm nhận nhẹ nhàng về khoảnh khắc quen thuộc trong bài gốc, rồi dẫn tự nhiên qua từng ý với giọng văn ấm áp, không thêm thông tin mua bán hay liên hệ.',
  },
  {
    id: 'friend_chat',
    label: 'Tâm sự nhẹ với bạn bè',
    instruction:
      'Viết tự nhiên như đang kể chuyện vui cùng bạn bè trong hội nhóm, thân mật, gần gũi, đổi cách đặt câu và bộ emoji khác biệt để tránh trùng lặp.',
  },
  {
    id: 'minimal_aesthetic',
    label: 'Ngắn gọn & giàu hình ảnh',
    instruction:
      'Trình bày từng ý ngắn gọn, giàu hình ảnh đời thường, dễ đọc nhanh trên Facebook mà vẫn giữ nguyên cảm xúc và ý chính của bài gốc.',
  },
];

export type WritingStyleId = 'auto' | 'professional' | 'friendly' | 'promo' | 'concise';

const WRITING_STYLE_INSTRUCTIONS: Record<WritingStyleId, string> = {
  auto: 'Giọng văn Facebook tự nhiên, chuyên nghiệp, linh hoạt thay đổi sắc thái theo đúng thể loại bài gốc (bài bán hàng hay bài chia sẻ/kể chuyện) để mỗi nhóm có một bài đăng khác biệt hoàn toàn.',
  professional:
    'Giọng văn CHUYÊN NGHIỆP & TINH TẾ: từ ngữ chọn lọc, mạch lạc, hạn chế từ ngữ suồng sã, bố cục sắc nét.',
  friendly:
    'Giọng văn THÂN THIỆN CỘNG ĐỒNG: gần gũi, dễ mến như chia sẻ tự nhiên trong hội nhóm thực tế, tạo thiện cảm.',
  promo:
    'Giọng văn NỔI BẬT GIÁ TRỊ: nhấn rõ điểm thu hút có trong bài gốc và lời gợi mở tương tác tự nhiên (không tự bịa ưu đãi hay số liên hệ nếu bài gốc không có).',
  concise:
    'Giọng văn NGẮN GỌN SÚC TÍCH: cô đọng tối đa, mỗi ý tối đa 1 dòng ngắn dễ quét mắt trên điện thoại, giữ đủ 100% ý chính bài gốc.',
};

function normalizeWritingStyle(value: unknown): WritingStyleId {
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase() as WritingStyleId;
    if (clean in WRITING_STYLE_INSTRUCTIONS) {
      return clean;
    }
  }
  return 'auto';
}

interface SourceFactProfile {
  phoneDigits: Set<string>;
  hasZalo: boolean;
  hasHotline: boolean;
  hasPrice: boolean;
  hasAddress: boolean;
  hasHashtags: boolean;
  hasUrls: boolean;
  isStorytelling: boolean;
}

const PHONE_LIKE_RE =
  /(?:(?:\+?84|0)\s*[\d.\-\s]{7,13}\d|(?:\+?84|0)\d{1,3}[\s.\-]*[xX*]{3,}[\d.\-\sxX*]*|(?:1800|1900)[\s.\-]*\d{4,6})/g;
const URL_LIKE_RE = /\b(?:https?:\/\/|www\.)[^\s]+/gi;

function extractPhoneDigits(text: string): Set<string> {
  const digits = new Set<string>();
  const matches = text.match(PHONE_LIKE_RE) || [];
  for (const m of matches) {
    const clean = m.replace(/\D/g, '');
    if (clean.length >= 8 && clean.length <= 12) {
      digits.add(clean);
      if (clean.startsWith('84') && clean.length >= 10) {
        digits.add('0' + clean.slice(2));
      }
    }
  }
  return digits;
}

function analyzeSourceFacts(sourceText: string): SourceFactProfile {
  const phoneDigits = extractPhoneDigits(sourceText);
  const hasZalo = /\bzalo\b/i.test(sourceText);
  const hasHotline = /\b(hotline|sđt|sdt|điện thoại|liên hệ|call|tel|inbox|nhắn tin)\b/i.test(sourceText);
  const hasPrice =
    /(\d+[\.,]?\d*\s*(k\b|đ\b|vnđ|vnd|tr\b|triệu|nghìn|ngàn|%|₫)|\b(giá bán|ưu đãi|trả góp|khuyến mãi|giảm giá|sale|voucher)\b)/i.test(
      sourceText,
    );
  const hasAddress =
    /\b(địa chỉ|số\s+\d+\s+[a-zA-ZÀ-ỹ]|đường\s+[a-zA-ZÀ-ỹ]|phường\s+|quận\s+|huyện\s+|cơ sở\s+\d|chi nhánh|showroom|giờ mở cửa|mở cửa\s+\d)/i.test(
      sourceText,
    );
  const hasHashtags = /#[\p{L}\p{N}_]+/u.test(sourceText);
  const hasUrls = URL_LIKE_RE.test(sourceText);
  URL_LIKE_RE.lastIndex = 0;

  const isStorytelling =
    phoneDigits.size === 0 && !hasZalo && !hasHotline && !hasPrice && !hasAddress;

  return {
    phoneDigits,
    hasZalo,
    hasHotline,
    hasPrice,
    hasAddress,
    hasHashtags,
    hasUrls,
    isStorytelling,
  };
}

/**
 * Deterministic safety net: guarantees the rewritten post NEVER contains fabricated
 * phone numbers, Zalo numbers, hotline placeholders, or URLs that did not exist in sourceText.
 */
function stripHallucinatedContacts(rewrittenText: string, sourceText: string, facts: SourceFactProfile): string {
  if (!rewrittenText) return '';
  const sourceLower = sourceText.toLowerCase();

  const lines = rewrittenText.split('\n');
  const kept: string[] = [];

  const contactLabelRe =
    /(hotline|zalo|sđt|sdt|số điện thoại|điện thoại|liên hệ|call|tel|tư vấn đặt in|đặt hàng ngay|inbox|ib ngay|địa chỉ\s*:|giờ mở cửa\s*:)/i;
  const placeholderRe = /(\[[^\]]*(sđt|sdt|số|zalo|hotline|địa chỉ|link|tên)[^\]]*\]|0\d{1,3}[\s.\-]*[xX*]{3,}|x{4,})/i;

  for (const rawLine of lines) {
    let line = rawLine;

    // 1. Check phone-like patterns in this line
    const phoneMatches = line.match(PHONE_LIKE_RE) || [];
    let hasFabricatedPhone = false;
    for (const m of phoneMatches) {
      const cleanDigits = m.replace(/\D/g, '');
      const hasMask = /[xX*]/.test(m);
      const isAllowed =
        !hasMask &&
        cleanDigits.length >= 8 &&
        (facts.phoneDigits.has(cleanDigits) ||
          (cleanDigits.startsWith('84') && facts.phoneDigits.has('0' + cleanDigits.slice(2))));
      if (!isAllowed) {
        hasFabricatedPhone = true;
      }
    }

    if (hasFabricatedPhone) {
      // Drop the entire line if it's a contact/CTA line or if source has no phones at all
      if (facts.phoneDigits.size === 0 || contactLabelRe.test(line)) {
        continue;
      }
      // Otherwise strip only the fabricated number
      line = line.replace(PHONE_LIKE_RE, (m) => {
        const cleanDigits = m.replace(/\D/g, '');
        if (!/[xX*]/.test(m) && facts.phoneDigits.has(cleanDigits)) return m;
        return '';
      });
    }

    // 2. Drop lines introducing Zalo / Hotline / SĐT / Placeholder contacts when absent in source
    if (
      facts.phoneDigits.size === 0 &&
      !facts.hasZalo &&
      /\b(zalo|hotline|sđt|sdt|số điện thoại)\b/i.test(line)
    ) {
      continue;
    }

    if (placeholderRe.test(line) && !placeholderRe.test(sourceText)) {
      continue;
    }

    // 3. Drop lines introducing fabricated Address / Opening hours when absent in source
    if (!facts.hasAddress && /^\s*[^\w\p{L}]*\s*(địa chỉ|giờ mở cửa|thời gian phục vụ|showroom|cơ sở)\s*:/iu.test(line)) {
      continue;
    }

    // 4. Strip fabricated URLs not in source
    if (!facts.hasUrls && URL_LIKE_RE.test(line)) {
      URL_LIKE_RE.lastIndex = 0;
      const lineUrls = line.match(URL_LIKE_RE) || [];
      const hasFakeUrl = lineUrls.some((u) => !sourceLower.includes(u.toLowerCase()));
      if (hasFakeUrl) {
        if (contactLabelRe.test(line) || line.replace(URL_LIKE_RE, '').trim().length < 18) {
          continue;
        }
        line = line.replace(URL_LIKE_RE, '').trim();
      }
    }
    URL_LIKE_RE.lastIndex = 0;

    // 5. Drop trailing pure-hashtag line if source had NO hashtags and is a storytelling post
    if (facts.isStorytelling && !facts.hasHashtags && /^#[\p{L}\p{N}_]/u.test(line.trim())) {
      continue;
    }

    kept.push(line);
  }

  return formatSalesContent(kept.join('\n'));
}

function selectAngle(variationIndex?: number, isStorytelling = false): CopywritingAngle {
  const pool = isStorytelling ? STORYTELLING_ANGLES : COPYWRITING_ANGLES;
  if (typeof variationIndex === 'number' && Number.isFinite(variationIndex) && variationIndex >= 0) {
    return pool[Math.floor(variationIndex) % pool.length];
  }
  const randomIdx = Math.floor(Math.random() * pool.length);
  return pool[randomIdx];
}

export function createGeminiClient(): GoogleGenAI | null {
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  let raw = err instanceof Error ? err.message : String(err || 'Lỗi kết nối Gemini AI');
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) {
        raw = parsed.error.message.trim();
      }
    } catch {
      // Keep original message if not valid JSON
    }
  }
  if (/API_KEY_INVALID|PERMISSION_DENIED|403|401|unauthenticated/i.test(raw)) {
    return {
      status: 403,
      message:
        'GEMINI_API_KEY không hợp lệ hoặc không có quyền gọi model. Vui lòng kiểm tra lại biến môi trường GEMINI_API_KEY trên máy chủ.',
    };
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return {
      status: 429,
      message:
        'GEMINI_API_KEY đang chạm giới hạn tốc độ / hạn mức (429). Vui lòng chờ vài giây rồi thử lại.',
    };
  }
  if (/UNAVAILABLE|high demand|overloaded|503/i.test(raw)) {
    return {
      status: 503,
      message: 'Hệ thống Gemini AI đang quá tải tạm thời (503). Vui lòng thử lại sau vài giây.',
    };
  }
  if (/timed out|aborted/i.test(raw)) {
    return {
      status: 504,
      message: 'Gemini AI phản hồi quá thời gian chờ. Vui lòng thử lại sau vài giây.',
    };
  }
  return { status: 502, message: raw };
}

async function generateWithTimeout(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  timeoutMs = 20000,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const mergedParams = {
      ...params,
      config: {
        ...(params.config ?? {}),
        abortSignal: controller.signal,
      },
    };
    return await Promise.race([
      ai.models.generateContent(mergedParams),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Gemini API request timed out'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractResponseText(response: {
  text?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
}): string {
  const direct = typeof response?.text === 'string' ? response.text.trim() : '';
  if (direct) return direct;

  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts
      .filter((p) => p && !p.thought && typeof p.text === 'string')
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (joined) return joined;
  }
  return '';
}

export async function generateWithFallback(
  ai: GoogleGenAI,
  requestedModel: string | undefined,
  contents: string,
  systemInstruction?: string,
  _seed?: number,
) {
  const primary = resolveGeminiModel(requestedModel);
  const secondary: SupportedGeminiModel =
    primary === 'gemini-3.1-flash-lite' ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite';

  const runAttempt = async (model: SupportedGeminiModel, timeoutMs: number) => {
    const config: Record<string, unknown> = {
      thinkingConfig: {
        thinkingLevel: model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
      },
    };
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const response = await generateWithTimeout(
      ai,
      {
        model,
        contents,
        config,
      },
      timeoutMs,
    );

    const text = extractResponseText(response);
    if (!text) {
      throw new Error(`Model ${model} returned empty text`);
    }

    return { response, text, usedModel: model };
  };

  let lastErr: unknown = null;
  const startedAt = Date.now();

  try {
    return await runAttempt(primary, 20000);
  } catch (err) {
    lastErr = err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(msg)) {
      throw err;
    }
  }

  // Fallback to secondary model
  try {
    return await runAttempt(secondary, 20000);
  } catch (fallbackErr) {
    lastErr = fallbackErr;
    const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    if (/API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(msg)) {
      throw fallbackErr;
    }

    // If both models failed quickly due to transient 503/high-demand, do one brief retry on primary
    if (/UNAVAILABLE|high demand|overloaded|503/i.test(msg) && Date.now() - startedAt < 25000) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        return await runAttempt(primary, 15000);
      } catch (retryErr) {
        lastErr = retryErr;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Không thể kết nối Gemini AI');
}

export async function rewritePostWithGemini(params: {
  content: unknown;
  customPrompt?: unknown;
  model?: unknown;
  groupName?: unknown;
  variationIndex?: unknown;
  totalVariations?: unknown;
  writingStyle?: unknown;
  avoidOpenings?: unknown;
}): Promise<
  | {
      ok: true;
      text: string;
      rewritten: string;
      model: string;
      angleId: string;
      angleLabel: string;
      writingStyle: WritingStyleId;
    }
  | { ok: false; status: number; error: string }
> {
  const {
    content,
    customPrompt,
    model,
    groupName,
    variationIndex,
    totalVariations,
    writingStyle,
    avoidOpenings,
  } = params;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return { ok: false, status: 400, error: 'Vui lòng nhập nội dung cần viết lại.' };
  }

  const ai = createGeminiClient();
  if (!ai) {
    return {
      ok: false,
      status: 503,
      error:
        'Chưa cấu hình GEMINI_API_KEY trên máy chủ Vercel. Vào Vercel → Project Settings → Environment Variables, thêm GEMINI_API_KEY rồi Redeploy.',
    };
  }

  const parsedVarIndex =
    typeof variationIndex === 'number' && Number.isFinite(variationIndex) && variationIndex >= 0
      ? Math.floor(variationIndex)
      : undefined;
  const parsedTotal =
    typeof totalVariations === 'number' && Number.isFinite(totalVariations) && totalVariations > 0
      ? Math.floor(totalVariations)
      : undefined;
  const styleId = normalizeWritingStyle(writingStyle);
  const facts = analyzeSourceFacts(content);
  const angle = selectAngle(parsedVarIndex, facts.isStorytelling);

  const sanitizedAvoidOpenings = Array.isArray(avoidOpenings)
    ? avoidOpenings
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 140))
        .slice(-10)
    : [];

  const cleanGroupName =
    typeof groupName === 'string' && groupName.trim() ? groupName.trim().slice(0, 120) : '';

  const defaultInstructions = facts.isStorytelling
    ? `Viết lại bài viết chia sẻ / kể chuyện sau thành một phiên bản MỚI MẺ, tự nhiên, giàu cảm xúc, trình bày thoáng mắt trên Facebook để chống trùng lặp khi đăng nhiều nhóm:

NGUYÊN TẮC BẮT BUỘC:
- GIỮ NGUYÊN thể loại chia sẻ / kể chuyện gần gũi và 100% ý chính, bối cảnh, hình ảnh có trong bài gốc.
- Đổi mới cách diễn đạt, câu mở đầu, nhịp câu và emoji cho tự nhiên, tránh lặp y nguyên câu chữ bài gốc.
- TUYỆT ĐỐI KHÔNG biến bài viết thành bài rao bán hàng, KHÔNG tự bịa thêm số điện thoại, Zalo, Hotline, địa chỉ, giá bán, ưu đãi, lời mời đặt hàng hay #hashtag không có trong bài gốc.
- KHÔNG dùng ký tự markdown (**in đậm**, *in nghiêng*, ###, \`\`\`).
- KHÔNG thêm lời dẫn hay ghi chú ("Dưới đây là...", "Biến thể...", "Phiên bản...").
- Chỉ trả về DUY NHẤT nội dung bài viết hoàn chỉnh bằng tiếng Việt.`
    : `Nâng cấp và viết lại nội dung sau thành một bài đăng Facebook chuyên nghiệp, tự nhiên, mạch lạc và thoáng mắt trên điện thoại:

BỐ CỤC LINH HOẠT (CHỈ đưa vào những mục CÓ THẬT trong bài gốc, tách đoạn bằng 1 dòng trống):
- Mở đầu thu hút tự nhiên (KHÔNG viết toàn bộ chữ IN HOA gây cảm giác spam).
- Các ý chính rõ ràng: mỗi ý dùng 1 emoji phù hợp ở đầu dòng và XUỐNG DÒNG RIÊNG.
- Nếu bài gốc có giá bán / ưu đãi: giữ nguyên 100% con số và điều kiện thật.
- Nếu bài gốc có thông tin liên hệ (địa chỉ, giờ mở cửa, Hotline/Zalo): giữ NGUYÊN VẸN đúng thông tin có trong bài gốc.
- Nếu bài gốc có #Hashtag: giữ ở dòng cuối cùng, tách bằng 1 dòng trống phía trên.

NGUYÊN TẮC BẮT BUỘC:
- GIỮ NGUYÊN 100% thông tin thực tế từ bài gốc. Tuyệt đối KHÔNG tự bịa thêm số điện thoại, Zalo, Hotline, địa chỉ, giờ mở cửa, giá bán hay ưu đãi không có trong bài gốc.
- KHÔNG dùng ký tự markdown (**in đậm**, *in nghiêng*, ###, \`\`\`).
- KHÔNG thêm lời dẫn hay ghi chú kiểu "Dưới đây là...", "Biến thể...", "Phiên bản...".
- Chỉ trả về DUY NHẤT nội dung bài viết hoàn chỉnh bằng tiếng Việt.`;

  // If user still has the legacy 5-block sales default prompt saved while posting a storytelling post,
  // prefer the storytelling-safe instructions so it never forces fake Hotline/Zalo blocks.
  const rawCustomPrompt = typeof customPrompt === 'string' ? customPrompt.trim() : '';
  const isLegacySalesPrompt =
    rawCustomPrompt.includes('CẤU TRÚC CHUẨN 5 KHỐI') && rawCustomPrompt.includes('Hotline/Zalo');
  const baseInstructions =
    rawCustomPrompt && !(facts.isStorytelling && isLegacySalesPrompt)
      ? rawCustomPrompt
      : defaultInstructions;

  const factGuards: string[] = ['[RÀNG BUỘC SỰ THẬT TỐI THƯỢNG — ƯU TIÊN CAO NHẤT]'];
  if (facts.phoneDigits.size === 0) {
    factGuards.push(
      '- CẤM TUYỆT ĐỐI: Bài gốc KHÔNG CÓ số điện thoại, KHÔNG CÓ Hotline, KHÔNG CÓ Zalo. KHÔNG ĐƯỢC tự bịa hay thêm bất kỳ SĐT, Zalo, Hotline hay ký tự giữ chỗ (như 09xx, [SĐT], xxxx) nào!',
    );
  } else {
    factGuards.push(
      '- GIỮ NGUYÊN CHÍNH XÁC từng chữ số điện thoại/Zalo có trong bài gốc, không thay đổi hay thêm số khác.',
    );
  }
  if (!facts.hasAddress) {
    factGuards.push('- Bài gốc KHÔNG CÓ địa chỉ hay giờ mở cửa → KHÔNG tự bịa địa chỉ hay khung giờ.');
  }
  if (!facts.hasPrice) {
    factGuards.push('- Bài gốc KHÔNG CÓ giá bán hay khuyến mãi → KHÔNG tự bịa giá, giảm giá hay trả góp.');
  }
  if (facts.isStorytelling) {
    factGuards.push(
      '- Bài gốc là bài chia sẻ / kể chuyện mềm (không bán hàng trực tiếp) → GIỮ đúng giọng kể chuyện gần gũi, KHÔNG thêm lời mời gọi chốt đơn, KHÔNG thêm Hotline/Zalo/địa chỉ, KHÔNG tự thêm #hashtag nếu bài gốc không có.',
    );
  }

  const variationDirectives: string[] = [
    ...factGuards,
    '',
    `[CHIẾN LƯỢC CHỐNG SPAM & KHÁC BIỆT HÓA BÀI ĐĂNG]`,
    `- Phong cách viết: ${WRITING_STYLE_INSTRUCTIONS[styleId]}`,
    `- Góc tiếp cận bắt buộc cho phiên bản này (${angle.label}): ${angle.instruction}`,
  ];

  if (parsedVarIndex !== undefined) {
    variationDirectives.push(
      `- Đây là biến thể riêng số #${parsedVarIndex + 1}${parsedTotal ? `/${parsedTotal}` : ''}. Hãy diễn đạt lại hoàn toàn câu mở đầu, cách sắp xếp các ý và bộ emoji để bài này khác biệt rõ rệt (trên 70% cách diễn đạt mới) so với bản gốc và các biến thể khác.`,
    );
  }

  if (cleanGroupName) {
    variationDirectives.push(
      `- Ngữ cảnh đăng bài: Hội nhóm Facebook "${cleanGroupName}". Giữ giọng văn tự nhiên phù hợp với thành viên nhóm (không cần chèn tên nhóm nếu nghe gượng gạo).`,
    );
  }

  if (sanitizedAvoidOpenings.length > 0) {
    variationDirectives.push(
      `- CẤM TRÙNG LẶP CÂU MỞ ĐẦU & CẤU TRÚC ĐÃ DÙNG Ở NHÓM TRƯỚC:\n${sanitizedAvoidOpenings
        .map((line, idx) => `  ${idx + 1}. "${line}"`)
        .join('\n')}\n  => Hãy viết một câu mở đầu, góc tiếp cận và cách trình bày HOÀN TOÀN MỚI, không lặp lại các cụm từ mở đầu trên.`,
    );
  }

  const promptBody = baseInstructions.includes('{{content}}')
    ? baseInstructions.replace(/\{\{content\}\}/gi, content.trim())
    : `${baseInstructions}\n\nNội dung gốc:\n${content.trim()}`;

  const finalPrompt = `${variationDirectives.join('\n')}\n\n${promptBody}`;

  const systemInstruction = facts.isStorytelling
    ? 'Bạn là cây viết nội dung Facebook tự nhiên tại Việt Nam. ' +
      'Nhiệm vụ: Viết lại bài chia sẻ / kể chuyện thành phiên bản mới mẻ, khác biệt về câu chữ và emoji để tránh trùng lặp khi đăng nhiều nhóm, đồng thời giữ nguyên 100% cảm xúc, bối cảnh và thông điệp gốc. ' +
      'QUY TẮC CẤM TUYỆT ĐỐI: KHÔNG bao giờ tự bịa thêm số điện thoại, Zalo, Hotline, địa chỉ, giá bán, ưu đãi, link web hay thông tin quảng cáo không có trong bài gốc. ' +
      'CHỈ trả về duy nhất nội dung bài viết hoàn chỉnh bằng tiếng Việt, KHÔNG markdown (**, *, ```), KHÔNG giải thích.'
    : 'Bạn là Senior Copywriter viết bài Facebook tự nhiên tại Việt Nam. ' +
      'Mục tiêu: (1) Nâng tầm nội dung mạch lạc, tự nhiên, trình bày thoáng mắt; ' +
      '(2) Tạo biến thể ĐỘC NHẤT chống spam cho từng hội nhóm bằng cách đổi câu mở đầu, góc tiếp cận, cách diễn đạt và emoji; ' +
      '(3) Bảo toàn 100% dữ kiện thật có trong bài gốc và TUYỆT ĐỐI KHÔNG tự bịa thêm số điện thoại, Zalo, Hotline, địa chỉ, giờ mở cửa hay giá bán nếu bài gốc không có; ' +
      '(4) CHỈ trả về duy nhất bài viết hoàn chỉnh bằng tiếng Việt, KHÔNG markdown (**, *, ```), KHÔNG giải thích.';

  const variationSeed =
    ((parsedVarIndex ?? Math.floor(Math.random() * 50)) + 1) * 1009 + (Date.now() % 100000);

  let rawText = '';
  let usedModel: SupportedGeminiModel;
  try {
    const out = await generateWithFallback(
      ai,
      typeof model === 'string' ? model : undefined,
      finalPrompt,
      systemInstruction,
      variationSeed,
    );
    rawText = out.text;
    usedModel = out.usedModel;
  } catch (err) {
    const formatted = formatGeminiError(err);
    if (/returned empty text/i.test(formatted.message)) {
      return { ok: false, status: 502, error: 'AI trả về nội dung rỗng. Vui lòng thử lại.' };
    }
    return { ok: false, status: formatted.status, error: formatted.message };
  }

  if (!rawText.trim()) {
    return { ok: false, status: 502, error: 'AI trả về nội dung rỗng. Vui lòng thử lại.' };
  }

  const cleanedRaw = formatSalesContent(cleanAiRewriteOutput(rawText)) || formatSalesContent(rawText);
  const cleaned = stripHallucinatedContacts(cleanedRaw, content, facts) || cleanedRaw;
  return {
    ok: true,
    text: cleaned,
    rewritten: cleaned,
    model: usedModel,
    angleId: angle.id,
    angleLabel: angle.label,
    writingStyle: styleId,
  };
}

export async function testGeminiConnection(requestedModel?: unknown): Promise<
  | { ok: true; model: string; latencyMs: number; reply: string }
  | { ok: false; status: number; error: string }
> {
  const ai = createGeminiClient();
  if (!ai) {
    return {
      ok: false,
      status: 503,
      error:
        'Chưa cấu hình GEMINI_API_KEY trên máy chủ Vercel. Vào Vercel → Project Settings → Environment Variables, thêm GEMINI_API_KEY rồi Redeploy.',
    };
  }

  const start = Date.now();
  try {
    const { text, usedModel } = await generateWithFallback(
      ai,
      typeof requestedModel === 'string' ? requestedModel : undefined,
      'Trả lời đúng 2 từ: Sẵn sàng.',
    );
    const latencyMs = Date.now() - start;

    return {
      ok: true,
      model: usedModel,
      latencyMs,
      reply: (text || 'Sẵn sàng').trim(),
    };
  } catch (err) {
    const formatted = formatGeminiError(err);
    return { ok: false, status: formatted.status, error: formatted.message };
  }
}
