// /og/agent/:id.png: 1200x630 preview card for an agent, used by X and other link previews.
import { ImageResponse } from '@vercel/og';
import { readAgent, parseId } from './_lib/registry.js';

export const config = { runtime: 'edge' };

const RED = '#c81b1c', LAB = '#8f8f8f', SUB = '#d9d9d9', LINE = 'rgba(255,255,255,.18)';

// Google Fonts serves TTF when the request has no browser user agent.
async function font(family, weight) {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}`, { signal: AbortSignal.timeout(3000) })).text();
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
    if (!src) return null;
    return { name: family, weight, style: 'normal', data: await (await fetch(src[1], { signal: AbortSignal.timeout(3000) })).arrayBuffer() };
  } catch (e) { return null; }
}

// Plain element objects, so no JSX build step is needed.
const el = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } });

function avatarSrc(meta) {
  const s = meta && typeof meta.image === 'string' ? meta.image.trim() : '';
  if (/^data:image\/(png|jpe?g);base64,/.test(s)) return s; // webp is not supported by the renderer
  if (/^https:\/\/.+\.(png|jpe?g)(\?.*)?$/i.test(s)) return s;
  return null;
}

function card(a, id, withImage) {
  const src = withImage && a ? avatarSrc(a.meta) : null;
  const name = a ? a.name : id != null ? `Agent #${id}` : 'Charter Agent';
  const desc = a ? (a.description || 'ERC-8004 agent on Robinhood Chain.') : 'This agent is not in the registry yet.';
  const svcs = a && a.meta && Array.isArray(a.meta.services) ? a.meta.services.filter(s => s && typeof s.name === 'string').map(s => s.name).filter((n, i, all) => all.indexOf(n) === i).slice(0, 4) : [];
  if (a && a.meta && a.meta.x402Support === true) svcs.push('x402');
  const avatar = src
    ? { type: 'img', props: { src, width: 168, height: 168, style: { width: 168, height: 168, objectFit: 'cover', border: `1px solid ${LINE}` } } }
    : el('div', { width: 168, height: 168, border: `1px solid ${LINE}`, alignItems: 'center', justifyContent: 'center', fontFamily: 'Space Grotesk', fontSize: 84, fontWeight: 700, color: '#fff' }, (name.charAt(0) || '?').toUpperCase());

  return el('div', { width: 1200, height: 630, background: '#000', color: '#fff', flexDirection: 'column', padding: '56px 64px', fontFamily: 'JetBrains Mono', position: 'relative',
      backgroundImage: 'radial-gradient(circle at 92% 18%, rgba(200,27,28,.30), rgba(0,0,0,0) 45%)' },
    el('div', { position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, background: RED }),
    el('div', { alignItems: 'center', justifyContent: 'space-between' },
      el('div', { alignItems: 'center', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 34, letterSpacing: -1 }, 'Charter', el('span', { color: RED }, '.'), 'AI'),
      el('div', { fontSize: 20, color: LAB, letterSpacing: 3 }, 'ERC-8004 · ROBINHOOD CHAIN')),
    el('div', { marginTop: 64, alignItems: 'center' },
      avatar,
      el('div', { flexDirection: 'column', marginLeft: 44, flex: 1, minWidth: 0 },
        el('div', { fontSize: 22, color: LAB, letterSpacing: 2 }, id != null ? `AGENT #${id}` : 'AGENT'),
        el('div', { marginTop: 12, fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: name.length > 22 ? 58 : 76, lineHeight: 1.05, letterSpacing: -2 }, name))),
    el('div', { marginTop: 36, fontSize: 25, lineHeight: 1.45, color: SUB, maxHeight: 74, overflow: 'hidden' }, desc.length > 130 ? desc.slice(0, 129).trimEnd() + '…' : desc),
    el('div', { marginTop: 'auto', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${LINE}`, paddingTop: 24 },
      el('div', { alignItems: 'center' }, ...(svcs.length ? svcs : ['on-chain identity']).map(s => el('div', { border: `1px solid ${LINE}`, padding: '8px 14px', marginRight: 10, fontSize: 18, color: '#fff' }, s))),
      el('div', { fontSize: 19, color: LAB }, a ? `owner ${a.owner.slice(0, 6)}…${a.owner.slice(-4)}` : 'charter ai')));
}

export default async function handler(req) {
  const url = new URL(req.url);
  const id = parseId(url.searchParams.get('id'));
  let a = null;
  if (id != null) { try { a = await readAgent(id); } catch (e) { a = null; } }
  const fonts = (await Promise.all([font('Space Grotesk', 700), font('JetBrains Mono', 400)])).filter(Boolean);
  const opts = { width: 1200, height: 630, fonts: fonts.length ? fonts : undefined };
  // Render to bytes here, so an avatar the renderer cannot read falls back to the initial-letter card.
  let png;
  try { png = await new ImageResponse(card(a, id, true), opts).arrayBuffer(); } catch (e) { png = null; }
  if (!png || !png.byteLength) png = await new ImageResponse(card(a, id, false), opts).arrayBuffer();
  return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300, s-maxage=3600' } });
}
