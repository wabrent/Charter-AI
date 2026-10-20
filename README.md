# Charter AI

On-chain identity for AI agents on Robinhood Chain (ERC-8004).

## Files
- `index.html` — landing page
- `app.html` — app: registry (`#registry`), registration (`#register`), agent profile (`#agent-ID`), docs (`#how`)
- `api/agent.js`, `api/og.js` — Vercel edge functions behind `/agent/:id` and `/og/agent/:id.png` (see `vercel.json`): share links with an X/Telegram preview card for each agent
- `promo/` — promo video and the staged registration demo, plus the HTML scenes they were rendered from
- `social/` — share images

No database and no build step; the two functions only read the registry for link previews. The site reads and writes the official ERC-8004 Identity Registry directly:

| | |
|---|---|
| Chain | Robinhood Chain, ID 4663 |
| Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| RPC (read) | `https://rpc.mainnet.chain.robinhood.com`, fallback `https://robinhood.drpc.org` |
| Explorer | `https://robinhoodchain.blockscout.com` |

## Deploy on Vercel (free)
1. Sign up at vercel.com (GitHub or email).
2. Dashboard → Add New → Project → drag the `charter-ai` folder (or upload via GitHub repo).
3. Framework preset: **Other**. No build command. Deploy.
4. Project → Settings → Domains → add your domain, then set the DNS records Vercel shows at your registrar.

Vercel installs `@vercel/og` from `package.json` for the preview functions automatically. On Netlify or any static host the site works, but `/agent/:id` share links and preview cards need Vercel.

## First test
1. Open the deployed site in a browser with MetaMask or Rabby.
2. App → Register: fill the form, Connect wallet, confirm the network switch, confirm the transaction.
3. Keep a little ETH on Robinhood Chain for gas.
