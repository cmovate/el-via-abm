# TODO.md
Last session: April 13, 2026 — El-Via ABM

## Completed this session

### Open Tech Jobs in Opportunities
- Built `company_jobs` DB table — caches open tech jobs per company
- Imported 469 tech jobs from 77 companies (TFT workspace) via Unipile LinkedIn search
- `GET /api/opportunities/company-jobs` reads from cache
- Opportunities UI: "Open tech jobs" dropdown per company — shows job title, location, Apply link
- jobsScraper **disabled from auto-start** (was crashing Railway) — trigger manually via `/api/opportunities/prefetch-jobs?workspace_id=X`

### FB Friend × LinkedIn Match
- Built `POST /api/opportunities/fb-linkedin-match` — searches one LinkedIn name, returns all profiles + flags if at company with open jobs
- **Incomplete** — LinkedIn rate limit (429) from JobsScraper earlier blocked the search
- All 144 FB friend names ready to run — needs to run 1 name per request, 5s apart, when rate limit resets (~1-2h after boot)

### CLY Campaign Bug Fix ⚠️ CRITICAL
- **Root cause found**: contacts with `already_connected=false` had `msg_sequence=NULL` after invite approved
- `messageSender` never sent messages because it queries `WHERE msg_sequence='new'` — NULL never matches
- **Fix deployed** (commit dda1829):
  1. `webhooks.js`: now sets `msg_sequence='new'` when invite approved and was NULL
  2. `server.js` startup migration: fixes all existing contacts with NULL msg_sequence
- **Railway needs manual redeploy** from dashboard — has been down ~40min due to crash loops from background jobs

## Pending / Known Issues
- Railway is DOWN — needs manual redeploy from Railway dashboard
- FB friend LinkedIn search (144 names) still pending — run after rate limit resets
- JobsScraper needs to be re-run manually after Railway recovers: `/api/opportunities/prefetch-jobs?workspace_id=3`
