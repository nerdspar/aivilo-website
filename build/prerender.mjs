/**
 * Aivilo static-site prerenderer (zero dependencies).
 *
 * Takes the single-file source at site/index.html and emits a clean,
 * SEO-friendly multi-page static site into dist/:
 *
 *   dist/index.html            (home)
 *   dist/platform/index.html   → served at /platform
 *   dist/services/index.html   → /services
 *   dist/partners/index.html   → /partners
 *   dist/company/index.html    → /company
 *   dist/contact/index.html    → /contact
 *   dist/404.html
 *   dist/sitemap.xml
 *   dist/robots.txt
 *   dist/favicon.svg, dist/og-image.svg
 *
 * Each page contains only its own view, with a unique <title>, meta
 * description, canonical URL, Open Graph/Twitter tags, and JSON-LD.
 *
 * The production origin is controlled by the SITE_URL env var
 * (default https://aivilo.nerdspar.com) so it can be changed at build
 * time without editing source.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SITE = join(ROOT, 'site');
const DIST = join(ROOT, 'dist');

const DEFAULT_SITE_URL = 'https://aivilo.nerdspar.com';
const SITE_URL = (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');

// Per-route SEO metadata. `route` matches the id `view-<route>` in the source.
const ROUTES = [
  {
    route: 'home', path: '/', schema: 'WebPage',
    title: 'Aivilo — Enterprise AI Services That Get You to Production',
    description: 'Aivilo is an AI services partner for healthcare and other regulated industries. We prove the ROI, do the engineering to reach production, and get it live — faster, and for less.',
  },
  {
    route: 'platform', path: '/platform', schema: 'WebPage',
    title: 'Lens — Observability & governance for AI operations | Aivilo',
    description: 'Lens is the platform behind every Aivilo engagement — it instruments your stack, orchestrates the work, and gives one live view of cost, quality, reliability, and governance.',
  },
  {
    route: 'services', path: '/services', schema: 'WebPage',
    title: 'Services — AI Readiness Assessment, Professional & Managed Services | Aivilo',
    description: 'Start with a free AI Readiness Assessment, get a costed AI Value Blueprint, then build and run it with Aivilo Professional and Managed Services.',
  },
  {
    route: 'partners', path: '/partners', schema: 'WebPage',
    title: 'Partners — Built on the platforms you already trust | Aivilo',
    description: 'Aivilo works across the modern AI ecosystem — AWS, Azure, NVIDIA, AMD, Intel, OpenAI, Anthropic, and Ingram Micro — deploying into your cloud and the tools your teams already use.',
  },
  {
    route: 'company', path: '/company', schema: 'AboutPage',
    title: 'Company — Turning AI ambition into measurable outcomes | Aivilo',
    description: 'Aivilo Cloud Technologies helps regulated organizations get AI out of the POC phase and into production ROI — with assessments, senior engineering, and managed operations.',
  },
  {
    route: 'contact', path: '/contact', schema: 'ContactPage',
    title: 'Contact — Talk to us about getting AI to production | Aivilo',
    description: 'Take the free AI Readiness Assessment, book a consultation, or scope a project. Tell us what you are wrestling with and we will reply within one business day.',
  },
];

const STATIC_ASSETS = [
  'favicon.svg', 'favicon-32.png', 'favicon-96.png', 'apple-touch-icon.png',
  'logo-horizontal.png', 'og-image.png',
];

const template = readFileSync(join(SITE, 'index.html'), 'utf8');

/* ---------- helpers ---------- */
const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
   .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/\s+/g, ' ').trim();

// Replace a single-capture-delimited attribute value without $-substitution surprises.
const setAttr = (html, re, value) => html.replace(re, (_full, pre, post) => pre + value + post);

/* ---------- split <main> into per-view blocks ---------- */
const mainMatch = template.match(/<main[^>]*>([\s\S]*?)<\/main>/);
if (!mainMatch) throw new Error('Could not find <main> in template');
const mainInner = mainMatch[1];

const viewRe = /<section class="view(?: active)?" id="view-([a-z]+)">/g;
const starts = [];
let m;
while ((m = viewRe.exec(mainInner)) !== null) starts.push({ route: m[1], index: m.index });

const viewBlocks = {};
for (let i = 0; i < starts.length; i++) {
  const from = starts[i].index;
  const to = i + 1 < starts.length ? starts[i + 1].index : mainInner.length;
  // Force the single view active.
  let block = mainInner.slice(from, to)
    .replace(/^<section class="view(?: active)?"/, '<section class="view active"');
  // Strip the trailing view-banner comments, one at a time. The tempered body
  // (?:(?!-->)[\s\S])* matches exactly one comment, so a strip can never span
  // across real markup between two comments.
  let prev;
  do { prev = block; block = block.replace(/\s*<!--(?:(?!-->)[\s\S])*-->\s*$/, ''); } while (block !== prev);
  viewBlocks[starts[i].route] = block.trim();
}

const missing = ROUTES.filter((r) => !viewBlocks[r.route]);
if (missing.length) throw new Error('Missing view blocks for: ' + missing.map((r) => r.route).join(', '));

/* ---------- structured data ---------- */
function pageSchema(meta, canonical) {
  return {
    '@context': 'https://schema.org',
    '@type': meta.schema,
    name: meta.title,
    description: meta.description,
    url: canonical,
    inLanguage: 'en',
    isPartOf: { '@id': SITE_URL + '/#website' },
    publisher: { '@id': SITE_URL + '/#organization' },
  };
}

function faqSchema(block) {
  const items = [];
  const qaRe = /<div class="qa"><button>([\s\S]*?)<span class="pm">[\s\S]*?<div class="ans"><p>([\s\S]*?)<\/p>/g;
  let q;
  while ((q = qaRe.exec(block)) !== null) {
    items.push({
      '@type': 'Question',
      name: decode(q[1]),
      acceptedAnswer: { '@type': 'Answer', text: decode(q[2]) },
    });
  }
  if (!items.length) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items };
}

/* ---------- build one page ---------- */
function buildPage(meta) {
  const view = viewBlocks[meta.route];
  const canonical = SITE_URL + meta.path;
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.description);

  // Swap <main> body for just this view (function form avoids $-substitution in dollar-heavy markup).
  let html = template.replace(/(<main[^>]*>)[\s\S]*?(<\/main>)/, (_f, open, close) => `${open}\n${view}\n${close}`);

  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
  html = setAttr(html, /(<meta name="description" content=")[^"]*(")/, desc);
  html = setAttr(html, /(<link rel="canonical" href=")[^"]*(")/, canonical);
  html = setAttr(html, /(<meta property="og:url" content=")[^"]*(")/, canonical);
  html = setAttr(html, /(<meta property="og:title" content=")[^"]*(")/, title);
  html = setAttr(html, /(<meta name="twitter:title" content=")[^"]*(")/, title);
  html = setAttr(html, /(<meta property="og:description" content=")[^"]*(")/, desc);
  html = setAttr(html, /(<meta name="twitter:description" content=")[^"]*(")/, desc);

  const ld = [pageSchema(meta, canonical)];
  if (meta.route === 'platform') {
    const faq = faqSchema(view);
    if (faq) ld.push(faq);
  }
  const ldScripts = ld
    .map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`)
    .join('\n');
  html = html.replace('</head>', () => `${ldScripts}\n</head>`);

  // Point every absolute URL at the configured origin.
  html = html.split(DEFAULT_SITE_URL).join(SITE_URL);
  return html;
}

/* ---------- 404 ---------- */
function build404() {
  const block = `<section class="view active">
    <div class="page-hero">
      <div class="container">
        <span class="eyebrow reveal">Error 404</span>
        <h1 class="h-xl reveal d1">This page took a wrong turn</h1>
        <p class="lead reveal d2">The page you're looking for doesn't exist or has moved. Let's get you back on track.</p>
        <div class="hero-actions reveal d3" style="margin-top:32px">
          <a class="btn btn-accent" href="/">Back to home</a>
          <a class="btn btn-light" href="/contact">Contact us</a>
        </div>
      </div>
    </div>
  </section>`;
  let html = template.replace(/(<main[^>]*>)[\s\S]*?(<\/main>)/, (_f, open, close) => `${open}\n${block}\n${close}`);
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => '<title>404 — Page not found | Aivilo</title>');
  html = setAttr(html, /(<meta name="robots" content=")[^"]*(")/, 'noindex, follow');
  html = html.split(DEFAULT_SITE_URL).join(SITE_URL);
  return html;
}

/* ---------- write everything ---------- */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

console.log(`Prerendering with SITE_URL=${SITE_URL}`);
for (const meta of ROUTES) {
  const outPath = meta.route === 'home' ? join(DIST, 'index.html') : join(DIST, meta.route, 'index.html');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buildPage(meta));
  console.log('  ✓', meta.path.padEnd(10), '→', outPath.replace(ROOT + '/', ''));
}

writeFileSync(join(DIST, '404.html'), build404());
console.log('  ✓ 404.html');

const today = new Date().toISOString().slice(0, 10);
const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  ROUTES.map((r) =>
    '  <url>\n' +
    `    <loc>${SITE_URL}${r.path}</loc>\n` +
    `    <lastmod>${today}</lastmod>\n` +
    '    <changefreq>weekly</changefreq>\n' +
    `    <priority>${r.route === 'home' ? '1.0' : '0.8'}</priority>\n` +
    '  </url>'
  ).join('\n') +
  '\n</urlset>\n';
writeFileSync(join(DIST, 'sitemap.xml'), sitemap);
console.log('  ✓ sitemap.xml');

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log('  ✓ robots.txt');

for (const asset of STATIC_ASSETS) {
  const src = join(SITE, asset);
  if (existsSync(src)) {
    copyFileSync(src, join(DIST, asset));
    console.log('  ✓', asset);
  }
}

console.log('Done.');
