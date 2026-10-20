// Reads one agent from the ERC-8004 Identity Registry on Robinhood Chain.
// Shared by the /agent/:id share page and its preview image.

export const REG = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPCS = ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood.drpc.org'];
const SEL = { tokenURI: '0xc87b56dd', ownerOf: '0x6352211e' };

function word(n) { return BigInt(n).toString(16).padStart(64, '0'); }

function decString(hex) {
  hex = (hex || '').replace(/^0x/, '');
  if (hex.length < 128) return '';
  const off = parseInt(hex.slice(0, 64), 16) * 2, len = parseInt(hex.slice(off, off + 64), 16);
  return new TextDecoder().decode(Uint8Array.from(hex.slice(off + 64, off + 64 + len * 2).match(/../g) || [], b => parseInt(b, 16)));
}

async function rpc(payload) {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(6000) });
      if (r.ok) return await r.json();
    } catch (e) { /* try the next RPC */ }
  }
  throw new Error('No Robinhood Chain RPC reachable');
}

function b64utf8(s) { return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); }

async function loadMeta(uri) {
  if (!uri) return null;
  try {
    const m = /^data:application\/json(;[^,]*)?,(.*)$/s.exec(uri);
    if (m) return JSON.parse(/;base64/i.test(m[1] || '') ? b64utf8(m[2]) : decodeURIComponent(m[2]));
    const url = uri.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
    if (!/^https:\/\//.test(url)) return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

/** Returns { id, owner, uri, meta, name, description } or null when the agent does not exist. */
export async function readAgent(id) {
  const res = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: REG, data: SEL.ownerOf + word(id) }, 'latest'] },
    { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: REG, data: SEL.tokenURI + word(id) }, 'latest'] },
  ]);
  const byId = {}; (Array.isArray(res) ? res : [res]).forEach(r => { byId[r.id] = r; });
  const o = byId[1] && byId[1].result;
  if (!o || o.length < 66 || /^0x0*$/.test(o)) return null;
  const owner = '0x' + o.slice(-40);
  const uri = byId[2] && byId[2].result ? decString(byId[2].result) : '';
  const meta = await loadMeta(uri);
  const name = meta && typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 80) : `Agent #${id}`;
  const description = meta && typeof meta.description === 'string' && meta.description.trim() ? meta.description.trim() : '';
  return { id, owner, uri, meta, name, description };
}

export function parseId(v) { return /^\d{1,9}$/.test(v || '') ? Number(v) : null; }
