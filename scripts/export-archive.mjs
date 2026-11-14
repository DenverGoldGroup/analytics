// One-off archive of every table in the analytics Supabase project, written as JSON under data/archive/ before the
// project is deleted (14 November 2026). Reads the Supabase URL and service-role key from the environment, or from
// a dotenv stream on stdin. The key is a sensitive variable on Vercel, which `vercel env pull` writes as an empty
// string, so it has to come from the Supabase dashboard (Project Settings > API keys) and be given on the command:
//
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/export-archive.mjs < /dev/null
//
// Nothing secret is printed and nothing secret is written: the magic-link tables (session tokens) are skipped and
// password hashes are dropped. Every other column of every other table is kept as PostgREST returns it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const SKIP = new Set(['admin_magic_links', 'psr_magic_links']);
const DROP_COLUMNS = { admin_users: ['password_hash'] };

async function env() {
  const vars = { ...process.env };
  if (!process.stdin.isTTY) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) vars[m[1]] = m[2];
    }
  }
  const url = vars.SUPABASE_URL || vars.NEXT_PUBLIC_SUPABASE_URL || 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
  const key = vars.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY is not in the environment'); process.exit(1); }
  return { url: url.replace(/\/$/, ''), key };
}

const { url, key } = await env();
// A new-style secret key (sb_secret_…) goes in the apikey header alone; the legacy JWT service_role key is also the bearer
const headers = { apikey: key, Accept: 'application/json', ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }) };

async function fetchAll(table, hasId) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const order = hasId ? '&order=id.asc' : '';
    const res = await fetch(`${url}/rest/v1/${table}?select=*${order}`, { headers: { ...headers, Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items' } });
    if (!res.ok && res.status !== 206) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

// The tables and whether each has an id column, as information_schema listed them on 14 November 2026
const TABLES = JSON.parse(readFileSync(new URL('./export-archive-tables.json', import.meta.url), 'utf8'));
const outDir = new URL('../data/archive/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const { table, has_id: hasId } of TABLES) {
  if (SKIP.has(table)) { manifest.push({ table, rows: 0, skipped: 'session tokens' }); continue; }
  let rows = await fetchAll(table, hasId);
  const drop = DROP_COLUMNS[table];
  if (drop) rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
  writeFileSync(new URL(`${table}.json`, outDir), JSON.stringify(rows, null, 1) + '\n');
  manifest.push({ table, rows: rows.length, dropped: drop || undefined });
  console.log(`${table}: ${rows.length} rows`);
}
writeFileSync(new URL('manifest.json', outDir), JSON.stringify({ exported: new Date().toISOString().slice(0, 10), project: 'ljyogcspkvqgjbiyzfbn', tables: manifest }, null, 2) + '\n');
console.log(`${manifest.length} tables written to data/archive/`);
