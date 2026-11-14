# Analytics database archive

A full export of the analytics site's Supabase project (`ljyogcspkvqgjbiyzfbn`), taken on 14 November 2026 before the
Vercel and Supabase projects were deleted. The site (analytics.miningforum.com) was replaced by the Post Show Reports
in EMS; this repository is kept as the archive. One JSON file per table, every column as PostgREST returned it;
`manifest.json` lists the tables and row counts, which matched the database's own counts at export time.

Made with `scripts/export-archive.mjs` (table list in `scripts/export-archive-tables.json`).

## What is here

| Table | Rows | What it is |
| --- | --- | --- |
| psr_* (18 tables) | — | The analytics Post Show Reports: events (MFE26, MFA26, MFA25; none locked), attendance, members, cancellations, engagement, financials, glossary, hotel, market data (Europe 2003–2026), meetings and top meetings, member history (2008–2025), member holdings, registration reconciliation, sponsors, SWOT, venue history, webcasts, brief inputs, activity log, users |
| companies, event_participations | 225, 424 | The membership roster and the MFE26/MFA26 participations, synced from EMS |
| attendees | 1,684 | Registration rows synced from EMS (names, company, title, city, country, class, status) |
| deals | 5 | The M&A Deal Book (dealbook.miningforum.com) |
| session_configs, session_definitions, session_slots | 1, 2, 396 | The session allocator |
| metal_prices | 5 | The last monthly spot-price snapshot |
| ems_sync_log | 76 | The daily EMS sync's log |
| admin_users | 2 | Admin accounts, password hashes dropped |

## What is not here

- `admin_magic_links` and `psr_magic_links`: sign-in tokens, skipped.
- `admin_users.password_hash`: dropped.

EMS imported what its Post Show Reports use (glossary, SWOT, engagement, hotel nights, venues, member history, Europe
market data, financial history) on 10–11 October 2026; the figures here are the analytics site's own as they stood at
export.
