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

export type WritingStyleId = 'auto' | 'professional' | 'friendly' | 'promo' | 'concise';

const WRITING_STYLE_INSTRUCTIONS: Record<WritingStyleId, string> = {
  auto: 'Giọng văn marketing Facebook chuyên nghiệp, tự nhiên, linh hoạt thay đổi sắc thái theo từng góc tiếp cận để mỗi nhóm có một bài đăng hoàn toàn riêng biệt, không trùng lặp công thức.',
  professional:
    'Giọng văn CHUYÊN NGHIỆP & CAO CẤP: từ ngữ chọn lọc, tinh tế, khẳng định giá trị và uy tín thương hiệu, hạn chế từ ngữ suồng sã, bố cục sắc nét.',
  friendly:
    'Giọng văn THÂN THIỆN CỘNG ĐỒNG: gần gũi, dễ mến như chia sẻ trong hội nhóm cư dân/người dùng thực tế, tạo thiện cảm tự nhiên và khuyến khích bình luận/nhắn tin.',
  promo:
    'Giọng văn CHỐT ĐƠN & ƯU ĐÃI MẠNH: nhấn rõ lợi ích tài chính, quyền lợi đi kèm và lời kêu gọi hành động thuyết phục nhưng vẫn lịch sự, đáng tin cậy (không giật tít rẻ tiền).',
  concise:
    'Giọng văn NGẮN GỌN SÚC TÍCH: cô đọng tối đa, mỗi ý tối đa 1 dòng ngắn dễ quét mắt trên điện thoại trong 5 giây, không rườm rà nhưng vẫn đủ 100% thông tin quan trọng.',
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

function selectAngle(variationIndex?: number): CopywritingAngle {
  if (typeof variationIndex === 'number' && Number.isFinite(variationIndex) && variationIndex >= 0) {
    return COPYWRITING_ANGLES[Math.floor(variationIndex) % COPYWRITING_ANGLES.length];
  }
  const randomIdx = Math.floor(Math.random() * COPYWRITING_ANGLES.length);
  return COPYWRITING_ANGLES[randomIdx];
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
  const raw = err instanceof Error ? err.message : String(err || 'Lỗi kết nối Gemini AI');
  if (/API_KEY_INVALID|PERMISSION_DENIED|403|401|unauthenticated/i.test(raw)) {
    return {
      status: 403,
      message:
        'GEMINI_API_KEY không hợp lệ hoặc không có quyền gọi model. Vui lòng kiểm tra lại biến môi trường GEMINI_API_KEY trên Vercel rồi Redeploy.',
    };
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return {
      status: 429,
      message:
        'GEMINI_API_KEY đang chạm giới hạn tốc độ / hạn mức (429). Vui lòng chờ vài giây rồi thử lại hoặc dùng API key có billing.',
    };
  }
  if (/timed out/i.test(raw)) {
    return {
      status: 504,
      message: 'Gemini AI phản hồi quá thời gian chờ. Vui lòng thử lại hoặc chuyển sang model Gemini 3.1 Flash Lite.',
    };
  }
  return { status: 502, message: raw };
}

async function generateWithTimeout(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  timeoutMs = 12000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ai.models.generateContent(params),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Gemini API request timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateWithFallback(
  ai: GoogleGenAI,
  requestedModel: string | undefined,
  contents: string,
  systemInstruction?: string,
  seed?: number,
) {
  const primary = resolveGeminiModel(requestedModel);
  const candidates: SupportedGeminiModel[] =
    primary === 'gemini-3.1-flash-lite'
      ? ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']
      : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

  let lastErr: unknown = null;
  for (const candidate of candidates) {
    try {
      const config: Record<string, unknown> = {};
      if (systemInstruction) config.systemInstruction = systemInstruction;
      if (candidate === 'gemini-4-hydrogen') {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      } else if (typeof seed === 'number' && Number.isFinite(seed)) {
        config.seed = Math.abs(Math.floor(seed));
      }

      const response = await generateWithTimeout(
        ai,
        {
          model: candidate,
          contents,
          ...(Object.keys(config).length > 0 ? { config } : {}),
        },
        candidate === 'gemini-4-hydrogen' ? 5500 : 10000,
      );
      return { response, usedModel: candidate };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Gemini] Model ${candidate} failed/timed out, trying fallback:`, msg);
      // Do not waste timeout retrying another model on invalid API key
      if (/API_KEY_INVALID/i.test(msg)) {
        break;
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
  const angle = selectAngle(parsedVarIndex);

  const sanitizedAvoidOpenings = Array.isArray(avoidOpenings)
    ? avoidOpenings
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 140))
        .slice(-10)
    : [];

  const cleanGroupName =
    typeof groupName === 'string' && groupName.trim() ? groupName.trim().slice(0, 120) : '';

  const baseInstructions =
    typeof customPrompt === 'string' && customPrompt.trim()
      ? customPrompt.trim()
      : `Nâng cấp và viết lại nội dung sau thành một bài đăng bán hàng Facebook CHUYÊN NGHIỆP, thuyết phục cao, tự nhiên như Copywriter thực thụ và trình bày cực kỳ thoáng mắt trên điện thoại:

CẤU TRÚC CHUẨN 5 KHỐI (tách nhau bằng 1 dòng trống):
1. Dòng mở đầu (Hook): 1 câu thu hút dừng lướt, tự nhiên, KHÔNG viết toàn bộ chữ IN HOA gây cảm giác spam.
2. Khối giá trị & điểm nổi bật: 3–4 gạch đầu dòng súc tích chuyển tính năng thành lợi ích thực tế cho người dùng. MỖI ý dùng 1 emoji phù hợp ở đầu dòng và XUỐNG DÒNG RIÊNG.
3. Khối giá bán & đặc quyền ưu đãi: tách thành đoạn riêng, mỗi quyền lợi (giá, trả góp, ưu đãi, thu cũ đổi mới...) nằm trên 1 dòng ngắn gọn, rõ ràng.
4. Khối kêu gọi hành động (CTA) & liên hệ: lời mời tự nhiên kèm thông tin liên hệ có trong bài gốc (địa chỉ, giờ mở cửa, Hotline/Zalo — chỉ viết đúng những mục có trong bài gốc), tách dòng dễ bấm gọi/nhắn tin.
5. Dòng cuối: cụm #Hashtag liên quan, tách riêng bằng 1 dòng trống phía trên.

NGUYÊN TẮC BẮT BUỘC:
- GIỮ NGUYÊN 100% thông tin thực tế từ bài gốc (tên sản phẩm, thương hiệu, giá bán, khuyến mãi, địa chỉ, khung giờ, số điện thoại, Zalo). Tuyệt đối KHÔNG tự bịa thêm giờ mở cửa, địa chỉ, thông số hay ưu đãi không có trong bài gốc.
- KHÔNG dùng ký tự markdown (**in đậm**, *in nghiêng*, ###, \`\`\`).
- KHÔNG thêm lời dẫn hay ghi chú kiểu "Dưới đây là...", "Biến thể...", "Phiên bản...".
- Chỉ trả về DUY NHẤT nội dung bài viết hoàn chỉnh bằng tiếng Việt.`;

  const variationDirectives: string[] = [
    `[CHIẾN LƯỢC CHỐNG SPAM & KHÁC BIỆT HÓA BÀI ĐĂNG]`,
    `- Phong cách viết: ${WRITING_STYLE_INSTRUCTIONS[styleId]}`,
    `- Góc tiếp cận bắt buộc cho phiên bản này (${angle.label}): ${angle.instruction}`,
  ];

  if (parsedVarIndex !== undefined) {
    variationDirectives.push(
      `- Đây là biến thể riêng số #${parsedVarIndex + 1}${parsedTotal ? `/${parsedTotal}` : ''}. Hãy diễn đạt lại hoàn toàn câu mở đầu, cách sắp xếp các ý nổi bật, bộ emoji và lời kêu gọi hành động (CTA) để bài này khác biệt rõ rệt (trên 70% cách diễn đạt mới) so với bản gốc và các biến thể khác.`,
    );
  }

  if (cleanGroupName) {
    variationDirectives.push(
      `- Ngữ cảnh đăng bài: Hội nhóm Facebook "${cleanGroupName}". Điều chỉnh giọng điệu mở đầu/CTA tự nhiên phù hợp với thành viên nhóm này (không cần lặp lại nguyên tên nhóm nếu nghe gượng gạo).`,
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

  const systemInstruction =
    'Bạn là Senior Copywriter chuyên viết bài bán hàng Facebook chuyển đổi cao tại Việt Nam. ' +
    'Mục tiêu tối thượng: (1) Nâng tầm nội dung trở nên chuyên nghiệp, mạch lạc, giàu sức thuyết phục, đọc tự nhiên như người thật viết; ' +
    '(2) Tạo biến thể ĐỘC NHẤT chống spam Facebook cho từng hội nhóm bằng cách đổi hoàn toàn câu hook, góc tiếp cận, cấu trúc câu, bộ emoji và câu CTA; ' +
    '(3) Bảo toàn tuyệt đối 100% dữ kiện thật (tên sản phẩm, giá, ưu đãi, địa chỉ, giờ mở cửa, Hotline, Zalo); ' +
    '(4) CHỈ trả về duy nhất bài viết hoàn chỉnh bằng tiếng Việt, KHÔNG markdown (**, *, ```), KHÔNG giải thích, mỗi ý emoji nằm trên 1 dòng riêng và tách đoạn rõ ràng bằng dòng trống.';

  const variationSeed =
    ((parsedVarIndex ?? Math.floor(Math.random() * 50)) + 1) * 1009 + (Date.now() % 100000);

  let response;
  let usedModel: SupportedGeminiModel;
  try {
    const out = await generateWithFallback(
      ai,
      typeof model === 'string' ? model : undefined,
      finalPrompt,
      systemInstruction,
      variationSeed,
    );
    response = out.response;
    usedModel = out.usedModel;
  } catch (err) {
    const formatted = formatGeminiError(err);
    return { ok: false, status: formatted.status, error: formatted.message };
  }

  const rawText = response.text ?? '';
  if (!rawText.trim()) {
    return { ok: false, status: 502, error: 'AI trả về nội dung rỗng. Vui lòng thử lại.' };
  }

  const cleaned = formatSalesContent(cleanAiRewriteOutput(rawText)) || formatSalesContent(rawText);
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
    const { response, usedModel } = await generateWithFallback(
      ai,
      typeof requestedModel === 'string' ? requestedModel : undefined,
      'Trả lời đúng 2 từ: Sẵn sàng.',
    );
    const latencyMs = Date.now() - start;

    return {
      ok: true,
      model: usedModel,
      latencyMs,
      reply: (response.text ?? 'Sẵn sàng').trim(),
    };
  } catch (err) {
    const formatted = formatGeminiError(err);
    return { ok: false, status: formatted.status, error: formatted.message };
  }
}
