import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import postcss from 'postcss';
import * as lightningcss from 'lightningcss';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT_DIR, 'web');

// ============================================================
// 1. Pre-compile JSX / JS files for Safari 11+ (iOS 10.3–18+)
//    Eliminates @babel/standalone and all ES2018+ syntax issues
// ============================================================
async function buildLegacyScripts() {
  const entries = [
    { src: path.join(WEB_DIR, 'app.jsx'), out: path.join(WEB_DIR, 'app.bundle.js'), loader: 'jsx' },
    { src: path.join(WEB_DIR, 'admin.jsx'), out: path.join(WEB_DIR, 'admin.bundle.js'), loader: 'jsx' },
    { src: path.join(WEB_DIR, 'login.js'), out: path.join(WEB_DIR, 'login.bundle.js'), loader: 'js' },
  ];

  for (const entry of entries) {
    const raw = fs.readFileSync(entry.src, 'utf8');
    const result = await esbuild.transform(raw, {
      loader: entry.loader,
      target: ['es2015', 'safari11'],
      format: 'iife',
      minify: true,
      charset: 'utf8',
      legalComments: 'none',
    });
    fs.writeFileSync(entry.out, result.code, 'utf8');
    console.log(
      `[build-web-legacy] JS  ${path.basename(entry.src)} -> ${path.basename(entry.out)} (${(result.code.length / 1024).toFixed(1)} KB)`
    );
  }
}

// ============================================================
// 2. Compile Tailwind CSS to 100% Legacy-iOS-Safe Static CSS
//    - Zero @layer (unsupported on iOS < 15.4)
//    - Zero @property dependency (defaults placed on *,::before,::after)
//    - Zero oklch() / oklab() / color-mix() (pre-resolved to hex/rgba)
//    - Zero :where() / complex :not() (unsupported on iOS < 14)
//    - Zero standalone inset / translate / scale / rotate
//    - vh + --app-vh fallbacks before every dvh (iOS < 15.4)
//    - Flexbox gap fallbacks for .no-flex-gap (iOS 10–14.4)
// ============================================================
const TAILWIND_INPUT_CSS = `
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-primary: #2563EB;
  --color-primary-hover: #1D4ED8;
  --color-background-light: #F3F4F6;
  --color-background-dark: #101622;
  --color-card-light: #ffffff;
  --color-border-light: #E5E7EB;
  --color-text-main: #111827;
  --color-text-secondary: #6B7280;
  --color-text-tertiary: #9CA3AF;

  --color-brand-50: #eff6ff;
  --color-brand-100: #dbeafe;
  --color-brand-600: #2563eb;
  --color-brand-700: #1d4ed8;
  --color-sidebar-bg: #0f172a;
  --color-sidebar-hover: #1e293b;
  --color-sidebar-border: #1e293b;

  --font-display: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-sans: "Plus Jakarta Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --shadow-soft: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  --shadow-card: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
  --shadow-glow: 0 0 15px -3px rgba(37, 99, 235, 0.3);
  --shadow-input: 0 1px 2px 0 rgba(0, 0, 0, 0.05);

  --text-xxs: 0.65rem;
  --text-xxs--line-height: 0.9rem;

  --animate-ping-slow: ping 3s cubic-bezier(0, 0, 0.2, 1) infinite;
  --animate-shimmer: shimmer 2s infinite;
  --animate-slide-in-right: slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  --animate-shrink: shrink 3s linear forwards;
}
`;

// Parse hex or rgb/rgba color into [r, g, b, a]
function parseCssColor(str) {
  const s = (str || '').trim();
  const hexMatch = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  const rgbaMatch = s.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/i);
  if (rgbaMatch) {
    let a = 1;
    if (rgbaMatch[4] !== undefined) {
      a = rgbaMatch[4].endsWith('%') ? parseFloat(rgbaMatch[4]) / 100 : parseFloat(rgbaMatch[4]);
    }
    return [Math.round(parseFloat(rgbaMatch[1])), Math.round(parseFloat(rgbaMatch[2])), Math.round(parseFloat(rgbaMatch[3])), a];
  }
  if (s === 'white') return [255, 255, 255, 1];
  if (s === 'black') return [0, 0, 0, 1];
  if (s === 'transparent') return [0, 0, 0, 0];
  return null;
}

// Resolve color-mix(in oklab|srgb, <color> <pct>%, transparent) using collected :root vars
function resolveColorMix(value, varMap) {
  if (!value || !value.includes('color-mix(')) return value;
  return value.replace(
    /color-mix\(\s*in\s+(?:oklab|oklch|srgb)\s*,\s*([^,]+?)\s+([\d.]+)%\s*,\s*transparent\s*\)/gi,
    (full, rawColor, pctStr) => {
      let c = rawColor.trim();
      const pct = Math.max(0, Math.min(100, parseFloat(pctStr))) / 100;
      if (c.toLowerCase() === 'currentcolor') {
        return `rgba(100, 116, 139, ${+pct.toFixed(4)})`;
      }
      const varMatch = c.match(/^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)$/);
      if (varMatch) {
        c = varMap.get(varMatch[1]) || (varMatch[2] ? varMatch[2].trim() : '');
      }
      const parsed = parseCssColor(c);
      if (!parsed) return full;
      const alpha = +(parsed[3] * pct).toFixed(4);
      return `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${alpha})`;
    }
  );
}

// Convert modern Safari 12+ space-separated rgb(r g b / a) to Safari 9+ rgba(r, g, b, a)
function normalizeModernRgb(value) {
  if (!value) return value;
  return value.replace(
    /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.%]+)\s*\)/gi,
    (_, r, g, b, aStr) => {
      const a = aStr.endsWith('%') ? +(parseFloat(aStr) / 100).toFixed(4) : parseFloat(aStr);
      return `rgba(${Math.round(parseFloat(r))}, ${Math.round(parseFloat(g))}, ${Math.round(parseFloat(b))}, ${a})`;
    }
  );
}

// Simplify :where(...) wrappers that break iOS 10–13 Safari
function stripWherePseudo(selector) {
  if (!selector || !selector.includes(':where(')) return selector;
  let out = selector;
  let guard = 0;
  while (out.includes(':where(') && guard++ < 20) {
    const start = out.indexOf(':where(');
    let depth = 0;
    let end = -1;
    for (let i = start + 6; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const inner = out.slice(start + 7, end);
    const before = out.slice(0, start);
    const after = out.slice(end + 1);

    if (inner === '.dark, .dark *') {
      out = before + '.dark' + after + ', .dark ' + before + after;
    } else if (inner.includes(',')) {
      const parts = inner.split(',').map((p) => p.trim());
      out = parts.map((p) => before + p + after).join(', ');
    } else {
      out = before + inner + after;
    }
  }
  return out;
}

// Build legacy flexbox gap fallbacks for iOS 10–14.4 (.no-flex-gap)
function buildFlexGapFallbacks() {
  const gaps = [
    ['0\\.5', '0.125rem'],
    ['1', '0.25rem'],
    ['1\\.5', '0.375rem'],
    ['2', '0.5rem'],
    ['2\\.5', '0.625rem'],
    ['3', '0.75rem'],
    ['3\\.5', '0.875rem'],
    ['4', '1rem'],
    ['5', '1.25rem'],
    ['6', '1.5rem'],
    ['7', '1.75rem'],
    ['8', '2rem'],
  ];
  const lines = [
    '/* Legacy iOS (< 14.5) Flexbox gap fallbacks */',
  ];
  for (const [cls, val] of gaps) {
    lines.push(
      `.no-flex-gap .flex.gap-${cls} > * + *, .no-flex-gap .inline-flex.gap-${cls} > * + * { margin-left: ${val}; }`,
      `.no-flex-gap .flex.flex-col.gap-${cls} > * + *, .no-flex-gap .inline-flex.flex-col.gap-${cls} > * + * { margin-left: 0; margin-top: ${val}; }`,
      `.no-flex-gap .flex.gap-x-${cls} > * + *, .no-flex-gap .inline-flex.gap-x-${cls} > * + * { margin-left: ${val}; }`,
      `.no-flex-gap .flex.flex-col.gap-y-${cls} > * + * { margin-top: ${val}; }`
    );
  }
  return lines.join('\n');
}

const LEGACY_TARGETS = {
  ios_saf: 11 << 16,
  safari: 11 << 16,
  chrome: 60 << 16, // Forces pure sRGB #hex/rgba instead of display-p3/oklch
};

async function buildLegacyTailwindCss() {
  const scanner = new Scanner({
    sources: [
      { base: WEB_DIR, pattern: '*.{html,jsx,js}', negated: false },
      { base: WEB_DIR, pattern: '*.bundle.js', negated: true },
      { base: WEB_DIR, pattern: 'tw-legacy.css', negated: true },
    ],
  });
  const candidates = scanner.scan();

  const compiler = await compile(TAILWIND_INPUT_CSS, {
    base: ROOT_DIR,
    onDependency: () => {},
  });
  const rawTwCss = compiler.build(candidates);

  // Pass 1: LightningCSS targeting iOS 11 + Chrome 60 -> converts ALL oklch/display-p3 to sRGB #hex/rgba
  const pass1 = lightningcss.transform({
    filename: 'tw-pass1.css',
    code: Buffer.from(rawTwCss),
    minify: false,
    targets: LEGACY_TARGETS,
  });

  const root = postcss.parse(pass1.code.toString('utf8'));
  const propertyDefaults = new Map();
  const rootVars = new Map();

  // Unwrap @layer blocks in document order
  root.walkAtRules('layer', (atRule) => {
    if (atRule.nodes && atRule.nodes.length > 0) {
      atRule.replaceWith(atRule.nodes);
    } else {
      atRule.remove();
    }
  });

  // Collect @property initial-value defaults, then remove @property
  root.walkAtRules('property', (atRule) => {
    const propName = atRule.params.trim();
    let initVal = null;
    atRule.walkDecls('initial-value', (d) => {
      initVal = d.value.trim();
    });
    if (propName.startsWith('--') && initVal !== null) {
      propertyDefaults.set(propName, initVal);
    }
    atRule.remove();
  });

  // Remove @supports progressive enhancement blocks for display-p3 / oklch / oklab / color-mix
  // (Tailwind v4 + LightningCSS already emit exact sRGB #hex / rgba() rules right before these blocks!)
  // Unwrap only Tailwind v4's @property fallback @supports block
  root.walkAtRules('supports', (atRule) => {
    const params = atRule.params || '';
    if (
      params.includes('display-p3') ||
      params.includes('oklch') ||
      params.includes('oklab') ||
      params.includes('color-mix')
    ) {
      atRule.remove();
      return;
    }
    if (params.includes('-webkit-hyphens') && params.includes('margin-trim')) {
      if (atRule.nodes && atRule.nodes.length > 0) {
        atRule.replaceWith(atRule.nodes);
      } else {
        atRule.remove();
      }
    }
  });

  // Collect :root custom property values (now 100% pure sRGB hex/rgba!)
  root.walkRules((rule) => {
    if (rule.selector.includes(':root') || rule.selector.includes(':host')) {
      rule.walkDecls((decl) => {
        if (decl.prop.startsWith('--')) {
          const val = decl.value.trim();
          if (!val.includes('display-p3') && !val.includes('oklch(') && !val.includes('oklab(')) {
            rootVars.set(decl.prop, val);
          }
        }
      });
    }
  });

  // Process all rules & declarations for iOS 10-15 safety
  root.walkRules((rule) => {
    // Strip LightningCSS LTR/RTL :is(:lang(ae),...) selectors (app is LTR Vietnamese)
    if (rule.selector.includes(':lang(ae)')) {
      if (rule.selector.includes(':not(:is(:lang(ae)')) {
        rule.selector = rule.selector.replace(/:not\(:is\(:lang\([^)]+\)(?:,\s*:lang\([^)]+\))*\)\)/g, '');
      } else {
        rule.remove();
        return;
      }
    }
    if (rule.selector.includes(':where(')) {
      rule.selector = stripWherePseudo(rule.selector);
    }
    if (rule.selector.includes(':not([hidden="until-found"])')) {
      rule.selector = rule.selector.replace(/:not\(\[hidden="until-found"\]\)/g, ':not([hidden])');
    }
    if (rule.selector.includes(':is(')) {
      rule.selector = rule.selector.replace(/:is\(([^()]+)\)/g, '$1');
    }

    rule.walkDecls((decl) => {
      let val = decl.value;

      if (val.includes('color-mix(')) {
        val = resolveColorMix(val, rootVars);
      }

      if (val.includes('/') && /rgba?\(/i.test(val)) {
        val = normalizeModernRgb(val);
      }

      if (val.includes(' in oklab') || val.includes(' in oklch') || val.includes(' in srgb')) {
        val = val.replace(/\s+in\s+(?:oklab|oklch|srgb)(?=\s*[,;})]|$)/gi, '');
      }

      decl.value = val;

      // Convert standalone CSS translate/scale/rotate (iOS 14.1+) into classic transform (iOS 9+)
      if (decl.prop === 'translate') {
        const parts = val.trim().split(/\s+/);
        const tx = parts[0] || '0';
        const ty = parts[1] || '0';
        decl.cloneBefore({ prop: '-webkit-transform', value: `translate(${tx}, ${ty})` });
        decl.cloneBefore({ prop: 'transform', value: `translate(${tx}, ${ty})` });
        decl.remove();
        return;
      }
      if (decl.prop === 'scale') {
        const parts = val.trim().split(/\s+/);
        const sx = parts[0] || '1';
        const sy = parts[1] || sx;
        decl.cloneBefore({ prop: '-webkit-transform', value: `scale(${sx}, ${sy})` });
        decl.cloneBefore({ prop: 'transform', value: `scale(${sx}, ${sy})` });
        decl.remove();
        return;
      }
      if (decl.prop === 'rotate') {
        decl.cloneBefore({ prop: '-webkit-transform', value: `rotate(${val.trim()})` });
        decl.cloneBefore({ prop: 'transform', value: `rotate(${val.trim()})` });
        decl.remove();
        return;
      }

      // Add vh + --app-vh fallbacks BEFORE dvh / svh / lvh declarations (iOS < 15.4)
      if (/\b\d+(?:\.\d+)?[dsl]vh\b/.test(val)) {
        const vhFallback = val.replace(/\b(\d+(?:\.\d+)?)[dsl]vh\b/g, '$1vh');
        const calcFallback = val.replace(/\b(\d+(?:\.\d+)?)[dsl]vh\b/g, 'calc(var(--app-vh, 1vh) * $1)');
        decl.cloneBefore({ value: vhFallback });
        decl.cloneBefore({ value: calcFallback });
      }

      if ((decl.prop === 'overflow-x' || decl.prop === 'overflow-y' || decl.prop === 'overflow') && val === 'clip') {
        decl.cloneBefore({ value: 'hidden' });
      }

      if (decl.prop === 'backdrop-filter') {
        decl.cloneBefore({ prop: '-webkit-backdrop-filter', value: val });
      }

      if (decl.prop === 'position' && val === 'sticky') {
        decl.cloneBefore({ prop: 'position', value: '-webkit-sticky' });
      }
    });
  });

  const universalDefaults = [
    '--tw-border-style: solid',
    '--tw-shadow: 0 0 #0000',
    '--tw-shadow-color: initial',
    '--tw-inset-shadow: 0 0 #0000',
    '--tw-ring-color: rgba(59, 130, 246, 0.5)',
    '--tw-ring-shadow: 0 0 #0000',
    '--tw-inset-ring-shadow: 0 0 #0000',
    '--tw-ring-inset: ',
    '--tw-ring-offset-width: 0px',
    '--tw-ring-offset-color: #fff',
    '--tw-ring-offset-shadow: 0 0 #0000',
    '--tw-translate-x: 0',
    '--tw-translate-y: 0',
    '--tw-translate-z: 0',
    '--tw-scale-x: 1',
    '--tw-scale-y: 1',
    '--tw-scale-z: 1',
    '--tw-rotate-x: rotateX(0)',
    '--tw-rotate-y: rotateY(0)',
    '--tw-rotate-z: rotateZ(0)',
    '--tw-skew-x: skewX(0)',
    '--tw-skew-y: skewY(0)',
    '--tw-gradient-position: initial',
    '--tw-gradient-from: #0000',
    '--tw-gradient-via: #0000',
    '--tw-gradient-to: #0000',
    '--tw-gradient-stops: initial',
    '--tw-gradient-from-position: 0%',
    '--tw-gradient-via-position: 50%',
    '--tw-gradient-to-position: 100%',
    '--tw-blur: ',
    '--tw-brightness: ',
    '--tw-contrast: ',
    '--tw-grayscale: ',
    '--tw-hue-rotate: ',
    '--tw-invert: ',
    '--tw-saturate: ',
    '--tw-sepia: ',
    '--tw-drop-shadow: ',
    '--tw-backdrop-blur: ',
    '--tw-backdrop-brightness: ',
    '--tw-backdrop-contrast: ',
    '--tw-backdrop-grayscale: ',
    '--tw-backdrop-hue-rotate: ',
    '--tw-backdrop-invert: ',
    '--tw-backdrop-opacity: ',
    '--tw-backdrop-saturate: ',
    '--tw-backdrop-sepia: ',
  ];

  for (const [k, v] of propertyDefaults.entries()) {
    if (!universalDefaults.some((line) => line.startsWith(k + ':'))) {
      universalDefaults.push(`${k}: ${v}`);
    }
  }

  const legacyHelpers = `
*, ::before, ::after {
  ${universalDefaults.join(';\n  ')};
}
${buildFlexGapFallbacks()}
`;

  const finalRaw = root.toString() + '\n' + legacyHelpers;

  const pass2 = lightningcss.transform({
    filename: 'tw-legacy.css',
    code: Buffer.from(finalRaw),
    minify: true,
    targets: LEGACY_TARGETS,
  });

  let outCss = pass2.code.toString('utf8');
  outCss = outCss.replace(/\s+in\s+(?:oklab|oklch|srgb)(?=\s*[,;})]|$)/gi, '');

  const outPath = path.join(WEB_DIR, 'tw-legacy.css');
  fs.writeFileSync(outPath, outCss, 'utf8');
  console.log(
    `[build-web-legacy] CSS tw-legacy.css generated (${(outCss.length / 1024).toFixed(1)} KB, ${candidates.length} candidates)`
  );
}

export async function runLegacyWebBuild() {
  await buildLegacyScripts();
  await buildLegacyTailwindCss();
}

// Run when invoked directly via CLI
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runLegacyWebBuild().catch((err) => {
    console.error('[build-web-legacy] Build failed:', err);
    process.exit(1);
  });
}
