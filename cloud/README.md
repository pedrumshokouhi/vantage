# Vantage (Cloudflare edition)

A private, single-user command centre at **https://vantage.pedrumshokouhi.com**. The only public page is the sign-in screen; everything else, including the app's own JavaScript, is served only to a signed-in session.

Runs entirely on Cloudflare's free plan: one Worker with static assets, one D1 database, and a Cron Trigger every 5 minutes.

## How it works

| Piece | What it does |
|---|---|
| `worker/worker.js` | Auth, API, asset gate, and the **engine**: every 5 minutes it collects news (15 RSS feeds), quotes, a GDELT attention sample, and a flight scan. Heavier jobs rotate: price histories, Bank of Canada, IMF PortWatch shipping, USGS quakes, travel advisories, SEC 13F, daily snapshots, pruning. It then writes signals to the Radar. |
| `worker/sources.js` | Feed lists, tickers, Bank of Canada series, hotspot definitions, proxy allow-list. |
| `worker/schema.sql` | D1 tables. New columns go in `MIGRATIONS` in `deploy.py` and `dev/devserver.py`. |
| `public/` | The app. Heavy analytics run in the browser, because the free plan allows ~10 ms of server CPU per request. This covers factor regressions, VaR, correlations and clusters, consequence maps, scenarios and hotspot scores. |
| `tools/build_seed.py` | Turns RBC holdings exports and a contacts CSV into `private/seed_live.sql`. That folder is git-ignored and chmod 700. |
| `deploy.py` | Stdlib-only deploy through the Cloudflare REST API. |
| `dev/` | Local harness: runs the real Worker inside the page, with D1 shimmed onto SQLite. |

Labels on every number: **fact / reported**, **calculated**, **statistical**, **estimate**, **interpretation**, **forecast**, **AI**, **demo**. Demo data lives in a separate DEMO workspace and never mixes with LIVE.

## Deploy

1. Create an API token in the Cloudflare dashboard (**My Profile → API Tokens → Create Token**):
   1. Start from the **Edit Cloudflare Workers** template.
   2. Add these permissions:
      - Account · D1 · Edit
      - Zone · DNS · Edit
      - Zone · Zone · Read
   3. Under **Zone Resources**, choose Include → Specific zone → `pedrumshokouhi.com`.
2. Copy the token, then save it without it touching your shell history:
   ```bash
   mkdir -p ~/.config/vantage && pbpaste > ~/.config/vantage/cf-token && chmod 600 ~/.config/vantage/cf-token
   ```
3. Deploy. `--seed` loads your holdings and contacts into LIVE, and only if LIVE is empty:
   ```bash
   python3 deploy.py --seed
   ```
   On the first deploy, it prints a one-time **setup code** and saves it to `~/.config/vantage/setup-code.txt`. Open https://vantage.pedrumshokouhi.com/login, enter the code, and choose your username and password.

   Your password never leaves the browser. It is stretched with PBKDF2-SHA256 (600,000 rounds) and the server stores only an HMAC of the result.
4. Check the engine: `python3 deploy.py --status`.
5. Delete the token in the dashboard when you're done. Create a new one for the next deploy.

## First things to do after signing in

- **Settings → Security**: turn on two-factor authentication and save the recovery codes.
- **Settings → Integrations → SEC EDGAR contact**: add your email. SEC blocks automated requests that don't declare a contact, so filings, 13F tracking and fund look-throughs stay blank until you add it. It is sent only to sec.gov.
- **Settings → Integrations → Claude** (optional): add an Anthropic API key to enable written synthesis, story analysis, meeting prep and thesis checks. Everything else works without it.
- **Network → Rate people**: rate your inner circle (keys 1–5, S to skip) to turn the address book into a relationship map.

## Updating holdings

Portfolio → **Import broker CSV**. Drop the latest RBC exports (several accounts at once). Positions are matched by broker symbol and account, and anything no longer in the export is offered for removal.

## Local development

```bash
python3 dev/devserver.py --port 8811 --seed   # setup code: DEV-SETUP-CODE
```

`--reset` starts from an empty database. `window.__harness.tick(["quotes"])` runs engine jobs by hand.

## Known limits (honest list)

- **Quotes**: from Yahoo Finance's unofficial chart API, delayed, and may change without notice. Front-month oil futures roll, so a large WTI/Brent divergence is flagged "roll?" and doesn't trigger alerts.
- **Oil and index history**: long history is weekly closes since 2000, requested with explicit dates. Yahoo's `range=max` silently drops months.
- **CDRs**: Yahoo only quotes CVX.NE and LVMH.NE for today, so they are left out of the risk model and fall back to the broker price when the quote is stale.
- **Shipping**: IMF PortWatch data lags about 5 days. "Normal" is the two years before the latest 90 days, so an ongoing disruption doesn't lower its own baseline.
- **GDELT**: rate-limits aggressively, so the attention component is sometimes missing. Hotspot scores then shrink toward neutral and are marked "limited".
- **Fund distributions**: a once-a-year payout from a mutual fund (e.g. JNRFX) is shown separately from income. It is mostly realised capital gains, not yield.
- **Dividend dates**: next ex-dates are projected from each holding's payment rhythm unless your broker supplied a future date. Macro release dates (US jobs report, Canada CPI) use their usual timing, so confirm them at the source.
