// /agent/:id share page. Crawlers (X, Telegram, Discord) read the Open Graph tags;
// people are sent on to the app profile at /app.html#agent-:id.
import { readAgent, parseId } from './_lib/registry.js';

export const config = { runtime: 'edge' };

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export default async function handler(req) {
  const url = new URL(req.url);
  const id = parseId(url.searchParams.get('id'));
  const origin = url.origin;
  let agent = null;
  if (id != null) { try { agent = await readAgent(id); } catch (e) { agent = undefined; } }

  const target = id != null ? `/app.html#agent-${id}` : '/app.html#registry';
  const title = agent ? `${agent.name} · Agent #${id} on Charter Agent` : id != null ? `Agent #${id} · Charter Agent` : 'Charter Agent';
  const desc = agent
    ? clip(agent.description || `ERC-8004 agent on Robinhood Chain, owned by ${agent.owner.slice(0, 6)}…${agent.owner.slice(-4)}.`, 200)
    : 'On-chain identity for AI agents on Robinhood Chain.';
  const image = `${origin}/og/agent/${id != null ? id : 0}.png`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Charter Agent">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + url.pathname)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="/icon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/icon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/icon-180.png">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<style>body{background:#000;color:#fff;font:15px/1.5 ui-monospace,monospace;padding:40px}a{color:#fff}</style>
</head><body>
<p>Opening <a href="${esc(target)}">${esc(title)}</a>…</p>
<script>location.replace(${JSON.stringify(target)})</script>
</body></html>`;

  return new Response(html, {
    status: agent === null && id != null ? 404 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60, s-maxage=600' },
  });
}
