# Charter AI

On-chain identity for AI agents on Robinhood Chain (ERC-8004).

## Files
- `index.html` — landing page
- `app.html` — app: registry (`#registry`), registration (`#register`), agent profile (`#agent-ID`), docs (`#how`)

Optional: `media/hero.mp4` — the landing video. If present it is served locally; otherwise the page falls back to the CDN copy, and then to a canvas animation.

No server, no database, no build step. The site reads and writes the official ERC-8004 Identity Registry directly:

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

Netlify works the same way: app.netlify.com → drag the folder onto "Deploy manually".

## First test
1. Open the deployed site in a browser with MetaMask or Rabby.
2. App → Register: fill the form, Connect wallet, confirm the network switch, confirm the transaction.
3. Keep a little ETH on Robinhood Chain for gas.
