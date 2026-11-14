# Mining Forum Event Analytics (retired)

**Retired 14 November 2026.** The site at analytics.miningforum.com, the M&A Deal Book at dealbook.miningforum.com,
their Vercel project and their Supabase database are gone. The Post Show Reports now live in EMS
(DenverGoldGroup/ems-laravel, `events/{event}/post-show-report`), which read their financials from the Budget app.

This repository is kept as the archive:

- `data/archive/` — every table of the database as JSON, exported on the day of retirement, with a README and a
  manifest of row counts.
- `api/`, `public/`, `scripts/` — the site's code as it last ran.
- `PROJECT-STATE.md` — the design notes from the last rebuild (March 2026).

Nothing here is deployed or deployable; the keys it needed no longer exist.
