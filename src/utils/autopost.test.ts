import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGeminiModel,
  spinContent,
  formatSalesContent,
  cleanAiRewriteOutput,
  clampDelayRange,
  calculateSubscriptionExpiry,
  validateFacebookShareUrl,
  normalizeGroupId,
  buildVietQrUrl,
} from './autopost.ts';

test('resolveGeminiModel keeps active models and maps deprecated models to default', () => {
  assert.equal(resolveGeminiModel('gemini-4-hydrogen'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiModel('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');
  assert.equal(resolveGeminiModel('gemini-1.5-flash'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiModel('gemini-2.0-flash'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiModel(''), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiModel(null), 'gemini-4-hydrogen');
});

test('spinContent resolves simple and nested spintax deterministically', () => {
  const alwaysFirst = () => 0;
  const alwaysLast = () => 0.999;

  assert.equal(
    spinContent('{Xin chào|Chào bạn} cả nhà! {Giảm 50%|Sale sốc}', alwaysFirst),
    'Xin chào cả nhà! Giảm 50%',
  );
  assert.equal(
    spinContent('{Xin chào|Chào bạn} cả nhà! {Giảm 50%|Sale sốc}', alwaysLast),
    'Chào bạn cả nhà! Sale sốc',
  );
  assert.equal(
    spinContent('{A|{B|C}}', alwaysLast),
    'C',
  );
  assert.equal(spinContent(''), '');
});

test('formatSalesContent normalizes CRLF and excessive blank lines', () => {
  assert.equal(
    formatSalesContent('  Dòng 1\r\n\r\n\r\n\r\nDòng 2\rDòng 3  '),
    'Dòng 1\n\nDòng 2\nDòng 3',
  );
});

test('cleanAiRewriteOutput removes preambles, braces, markdown, and self-checks', () => {
  const messy = `Final version:
{
**🔥 SIÊU SALE CUỐI TUẦN!**

Giảm ngay 50% cho tất cả đơn hàng hôm nay.
Wait, let me check tone? Yes
Checklist: good
#sale #uudai
}
Note: đã kiểm tra xong`;

  const cleaned = cleanAiRewriteOutput(messy);
  assert.equal(
    cleaned,
    '🔥 SIÊU SALE CUỐI TUẦN!\n\nGiảm ngay 50% cho tất cả đơn hàng hôm nay.\n#sale #uudai',
  );
});

test('clampDelayRange guards NaN, empty strings, and inverted bounds', () => {
  assert.deepEqual(clampDelayRange('', ''), { min: 10, max: 40 });
  assert.deepEqual(clampDelayRange(Number.NaN, 15), { min: 10, max: 15 });
  assert.deepEqual(clampDelayRange(90, 30), { min: 90, max: 120 });
  assert.deepEqual(clampDelayRange(60, 120), { min: 60, max: 120 });
});

test('calculateSubscriptionExpiry extends active future plans and handles invalid months', () => {
  const now = new Date('2026-01-15T00:00:00.000Z');
  const fromNow = calculateSubscriptionExpiry(null, 3, now);
  assert.equal(fromNow, '2026-04-15T00:00:00.000Z');

  const futureBase = '2026-03-01T00:00:00.000Z';
  const extended = calculateSubscriptionExpiry(futureBase, 2, now);
  assert.equal(extended, '2026-05-01T00:00:00.000Z');

  // Empty or invalid months defaults safely to 1 month
  const fallback = calculateSubscriptionExpiry(null, '', now);
  assert.equal(fallback, '2026-02-15T00:00:00.000Z');
});

test('validateFacebookShareUrl accepts valid posts and rejects photo stubs or external links', () => {
  assert.equal(validateFacebookShareUrl('https://www.facebook.com/page/posts/123456'), true);
  assert.equal(validateFacebookShareUrl('https://m.facebook.com/story.php?id=1'), true);
  assert.equal(validateFacebookShareUrl('https://www.facebook.com/photo/'), false);
  assert.equal(validateFacebookShareUrl('https://example.com/post/1'), false);
  assert.equal(validateFacebookShareUrl(''), false);
});

test('normalizeGroupId coerces numbers and trims whitespace', () => {
  assert.equal(normalizeGroupId(123456), '123456');
  assert.equal(normalizeGroupId('  987654  '), '987654');
  assert.equal(normalizeGroupId(null), '');
});

test('buildVietQrUrl encodes transfer info and bank details', () => {
  const url = buildVietQrUrl({
    bankName: 'vcb',
    bankNo: '123456789',
    bankUser: 'NGUYEN VAN A',
    amount: 199000,
    addInfo: 'PRO 1T',
  });
  assert.ok(url.startsWith('https://img.vietqr.io/image/vcb-123456789-compact.png?'));
  assert.ok(url.includes('amount=199000'));
  assert.ok(url.includes('addInfo=PRO%201T'));
  assert.ok(url.includes('accountName=NGUYEN%20VAN%20A'));
});
