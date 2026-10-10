// EMS API client (api.miningforum.com), server only. The underscore keeps Vercel from serving this file as a route.
// The service key is a team shared variable, read here and nowhere else: never in public/, never logged.
// Every call has a timeout, logs one line, and returns null on any failure so the caller falls back.
// Local work without the key: set EMS_FIXTURE to a JSON file of {"<path>": <response body>} with invented data.
const fs = require('fs');

const BASE = (process.env.EMS_API_URL || 'https://api.miningforum.com').replace(/\/$/, '');
var _fixture;
function fixture() {
  if (_fixture === undefined) {
    _fixture = null;
    if (process.env.EMS_FIXTURE) {
      try { _fixture = JSON.parse(fs.readFileSync(process.env.EMS_FIXTURE, 'utf8')); }
      catch (err) { console.warn('[ems] fixture unreadable: ' + err.message); }
    }
  }
  return _fixture;
}

// One EMS read: resolves to the {data, meta} envelope, or null
async function ems(path, params) {
  var fx = fixture();
  if (fx) return fx[path] || null;
  var key = process.env.EMS_API_KEY;
  if (!key) { console.warn('[ems] ' + path + ': EMS_API_KEY is not set for this deployment'); return null; }
  var qs = new URLSearchParams();
  Object.keys(params || {}).forEach(function(k) { if (params[k] != null) qs.set(k, String(params[k])); });
  var url = BASE + path + (qs.toString() ? '?' + qs.toString() : '');
  try {
    var res = await fetch(url, { headers: { Accept: 'application/json', 'X-Api-Key': key }, signal: AbortSignal.timeout(10000) });
    // HTML instead of JSON: something in front of the API (a Cloudflare challenge) answered. Report it; never work round it.
    if ((res.headers.get('content-type') || '').indexOf('json') === -1) { console.warn('[ems] ' + path + ': ' + res.status + ' non-JSON reply'); return null; }
    var body = await res.json();
    if (!res.ok) { console.warn('[ems] ' + path + ': ' + res.status + ' ' + ((body && body.message) || '')); return null; }
    console.log('[ems] ' + path + ': ' + (Array.isArray(body.data) ? body.data.length + ' records' : body.data ? 'ok' : 'empty'));
    return body;
  } catch (err) {
    console.warn('[ems] ' + path + ' failed: ' + err.message);
    return null;
  }
}

// EMS codes differ from DGG's in places (Australia 2027 is MFS27 in EMS, MFAU27 on DGG files)
var CODE_ALIASES = { MFAU27: 'MFS27' };

// The EMS event for a DGG event code, from the event list (never a hard-coded id)
async function eventByCode(code) {
  var want = String(code || '').toUpperCase();
  want = CODE_ALIASES[want] || want;
  var list = await ems('/events');
  var hit = list && Array.isArray(list.data) ? list.data.filter(function(e) { return String(e.code || '').toUpperCase() === want; })[0] : null;
  return hit || null;
}

module.exports = { ems: ems, eventByCode: eventByCode, CODE_ALIASES: CODE_ALIASES };
