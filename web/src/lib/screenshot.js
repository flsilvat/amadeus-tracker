// =============================================================================
// "Copy as image" — render a phone-width ExportSheet off-screen, rasterise it
// to PNG with html-to-image, and put it on the clipboard (download fallback).
// =============================================================================

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { toBlob } from 'html-to-image';
import ExportSheet, { SHEET_BG } from '../components/ExportSheet.jsx';
import { planLayout } from './exportLayout.js';

// 2x the 390pt sheet = 780px wide: crisp on a phone, still a small PNG.
const PIXEL_RATIO = 2;

// The page's Google Fonts CSS with the font files inlined as data: URLs, so
// the rasteriser (an isolated SVG document) can use Hanken Grotesk and
// JetBrains Mono. Latin subset only — the cards are ASCII plus a few symbols
// the system fallback font draws anyway — which keeps the SVG small. Built
// once per page load. (html-to-image's own embedder also works, but it logs
// SecurityErrors probing the cross-origin sheet and inserts the fetched rules
// into the page's stylesheet.) If the fonts can't be fetched (blocked
// network) the image falls back to system fonts, like the page itself.
let fontCssPromise = null;
function fontCss() {
  if (!fontCssPromise) {
    fontCssPromise = buildFontCss().catch((e) => {
      console.warn('Web fonts could not be embedded; the image will use system fonts.', e);
      return '';
    });
  }
  return fontCssPromise;
}

const URL_RE = /url\((["']?)(https?:[^)"']+)\1\)/g;

async function buildFontCss() {
  const hrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((l) => l.href).filter((h) => /fonts\.googleapis\.com/.test(h));
  const blocks = [];
  for (const href of hrefs) {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
    for (const block of (await res.text()).match(/@font-face\s*\{[^}]*\}/g) || []) {
      const range = /unicode-range:\s*([^;]+)/.exec(block);
      if (!range || /U\+0000-00FF/i.test(range[1])) blocks.push(block);
    }
  }
  const urls = [...new Set(blocks.flatMap((b) => Array.from(b.matchAll(URL_RE), (m) => m[2])))];
  const data = new Map(await Promise.all(urls.map(async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
    return [u, await blobToDataUrl(await res.blob())];
  })));
  return blocks.map((b) => b.replace(URL_RE, (m, q, u) => `url(${data.get(u)})`)).join('\n');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function isSafari() {
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR/i.test(ua);
}

// Mount the sheet in a fixed host parked off-screen (the host carries the
// offset so the sheet itself stays position:static — html-to-image copies
// computed styles onto its clone, and a fixed/offset root would render blank).
// Desktop mode renders twice: a measuring stack first, to learn each card's
// height, then the planned masonry layout.
async function renderSheetPng(props) {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;top:0;left:-10000px;z-index:-1;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (p) => new Promise((resolve) => root.render(createElement(ExportSheet, { ...p, onMounted: resolve })));
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    if (props.mode === 'desktop') {
      await render({ ...props, plan: null });
      const heights = {};
      host.querySelectorAll('[data-key]').forEach((el) => { heights[el.dataset.key] = el.offsetHeight; });
      await render({ ...props, plan: planLayout(props.sections, heights, { title: !!props.title, footer: !!props.myCode }) });
    } else {
      await render(props);
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sheet = host.firstElementChild;
    const opts = { pixelRatio: PIXEL_RATIO, backgroundColor: SHEET_BG, fontEmbedCSS: await fontCss() };
    // Safari tends to return a blank/partial raster on the first pass (fonts
    // not yet applied inside the SVG clone); the second pass is reliable.
    if (isSafari()) await toBlob(sheet, opts);
    const blob = await toBlob(sheet, opts);
    if (!blob) throw new Error('the browser returned no image data');
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
}

/**
 * Render `sheetProps` (see ExportSheet; `mode` is 'phone' or 'desktop') and
 * copy the PNG to the clipboard.
 * Resolves 'clipboard' on success, or 'download' when the browser would not
 * take the clipboard write (insecure origin, permissions, old browser) and
 * the PNG was saved as `filename` instead. Rejects if rendering failed.
 */
export async function copySheetImage(sheetProps, filename) {
  const png = renderSheetPng(sheetProps);
  png.catch(() => {}); // surfaced through the awaits below, not as an unhandled rejection
  const canWrite = typeof navigator !== 'undefined' && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined';
  if (canWrite) {
    // Hand the clipboard the *pending* PNG: Safari only honours writes that
    // start inside the user gesture, and a Promise value keeps that activation
    // alive while we render. Chrome accepts the same shape.
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return 'clipboard';
    } catch { /* promise values unsupported, or write refused — retry with the blob */ }
    const blob = await png;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'clipboard';
    } catch { /* clipboard unavailable here (http, denied, embedded) */ }
  }
  downloadBlob(await png, filename);
  return 'download';
}
