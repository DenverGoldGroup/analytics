// Supabase client configuration
const SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqeW9nY3Nwa3ZxZ2piaXl6ZmJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyODE5OTAsImV4cCI6MjA4ODg1Nzk5MH0.oBKfsngoLIUjZl-w-iZm3W8Q4kMuFAAICidEdszNyGE';

// createClient is exposed on the global `supabase` object by the CDN bundle
if (!window.supabase || !window.supabase.createClient) {
  console.error('Supabase CDN failed to load. window.supabase =', window.supabase);
  document.addEventListener('DOMContentLoaded', function() {
    var el = document.getElementById('content');
    if (el) el.innerHTML = '<div style="padding:40px;text-align:center;color:#E74C3C"><h3>Failed to load Supabase library</h3><p style="font-size:12px;color:#7F8C8D">The CDN script did not load correctly.</p></div>';
  });
}
var sb = window.supabase && window.supabase.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Fetch all DGG member companies (unduplicated)
async function fetchDGGCompanies() {
  if (!sb) { console.error('Supabase client not initialized'); return []; }
  try {
    const { data, error } = await sb
      .from('companies')
      .select('*')
      .order('market_cap_usd', { ascending: false, nullsFirst: false });
    if (error) { console.error('Error fetching companies:', error); return []; }
    console.log('Fetched', (data || []).length, 'companies');
    return data || [];
  } catch (err) {
    console.error('fetchDGGCompanies exception:', err);
    return [];
  }
}

// Fetch event participations by event code
async function fetchEventParticipations(eventCode) {
  if (!sb) { console.error('Supabase client not initialized'); return []; }
  try {
    const { data, error } = await sb
      .from('event_participations')
      .select('*')
      .eq('event_code', eventCode)
      .order('market_cap_usd', { ascending: false, nullsFirst: false });
    if (error) { console.error('Error fetching participations:', error); return []; }
    console.log('Fetched', (data || []).length, 'participations for', eventCode);
    return data || [];
  } catch (err) {
    console.error('fetchEventParticipations exception:', err);
    return [];
  }
}

// Mineral group classification
const MINERAL_GROUPS = {
  'Gold': { group: 'Gold', color: '#D4A017' },
  'Silver': { group: 'Silver', color: '#7F8C8D' },
  'Platinum Group': { group: 'PGMs', color: '#8E44AD' },
  'Palladium': { group: 'PGMs', color: '#8E44AD' },
  'Copper': { group: 'Copper', color: '#CA6F1E' },
};

function getMineralGroup(mineral) {
  return MINERAL_GROUPS[mineral] || { group: 'Other', color: '#27AE60' };
}

// Status ordering and colors
const STATUS_ORDER = [
  'Producer',
  'Royalty / Streaming',
  'Developer (construction/feasibility)',
  'Developer (PEA/scoping)',
  'Explorer (advanced)',
  'Explorer (early-stage)',
  'Bullion Dealer'
];

const STATUS_COLORS = {
  'Producer': '#27AE60',
  'Royalty/Streaming': '#2980B9',
  'Royalty / Streaming': '#2980B9',
  'Developer (construction/feasibility)': '#E67E22',
  'Developer (PEA/scoping)': '#F39C12',
  'Explorer (advanced)': '#9B59B6',
  'Explorer (early-stage)': '#1ABC9C',
  'Bullion Dealer': '#95A5A6'
};

function getStatusColor(status) {
  return STATUS_COLORS[status] || '#95A5A6';
}

// Gold-equivalent conversion ratios
const AU_EQ_RATIOS = {
  'Gold': 1.0,
  'Silver': 1/80,
  'Platinum Group': 1.5,
  'Palladium': 1.5,
  'Copper': 3.2,
};

function getAuEqRatio(mineral) {
  return AU_EQ_RATIOS[mineral] || 0.0001;
}

// Spot metal prices cache
var _spotPrices = null;
var _spotPricesPromise = null;

// Map mineral group names to metals.dev keys
var MINERAL_SPOT_MAP = {
  'Gold': 'gold',
  'Silver': 'silver',
  'PGMs': 'platinum',    // Use platinum as the representative PGM price
  'Copper': 'copper'
};

function fetchSpotPrices() {
  if (_spotPricesPromise) return _spotPricesPromise;
  _spotPricesPromise = fetch('/api/metals')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.ok && data.metals) {
        _spotPrices = data.metals;
      }
      return _spotPrices;
    })
    .catch(function(err) {
      console.error('Failed to fetch spot prices:', err);
      return null;
    });
  return _spotPricesPromise;
}

function getSpotPrice(mineralGroup) {
  if (!_spotPrices) return null;
  var key = MINERAL_SPOT_MAP[mineralGroup];
  if (!key || !_spotPrices[key]) return null;
  return _spotPrices[key];
}

function formatSpotPrice(price, metal) {
  if (price == null) return '';
  // Copper is per pound, precious metals per troy oz
  if (price >= 1000) return '$' + Number(price).toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 10) return '$' + Number(price).toFixed(2);
  return '$' + Number(price).toFixed(4);
}

// Format market cap for display
function formatMcap(mcapUsd) {
  if (!mcapUsd || mcapUsd === 0) return '—';
  if (mcapUsd >= 1e12) return '$' + (mcapUsd / 1e12).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'T';
  if (mcapUsd >= 1e9) return '$' + (mcapUsd / 1e9).toFixed(2) + 'B';
  if (mcapUsd >= 1e6) return '$' + (mcapUsd / 1e6).toFixed(1) + 'M';
  return '$' + Math.round(mcapUsd).toLocaleString();
}

// Format number with commas
function formatNum(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString();
}

// Country flag emoji (ISO 3166-1 alpha-2 → flag)
const COUNTRY_FLAGS = {
  'Australia': '🇦🇺', 'Brazil': '🇧🇷', 'Canada': '🇨🇦', 'Chile': '🇨🇱',
  'China': '🇨🇳', 'Colombia': '🇨🇴', 'Congo (DRC)': '🇨🇩', 'Ecuador': '🇪🇨',
  'Egypt': '🇪🇬', 'Finland': '🇫🇮', 'France': '🇫🇷', 'Greece': '🇬🇷',
  'Guatemala': '🇬🇹', 'Guyana': '🇬🇾', 'Indonesia': '🇮🇩', 'Ireland': '🇮🇪',
  'Ivory Coast': '🇨🇮', 'Japan': '🇯🇵', 'Mali': '🇲🇱', 'Mexico': '🇲🇽',
  'Mongolia': '🇲🇳', 'New Zealand': '🇳🇿', 'Nicaragua': '🇳🇮', 'Nigeria': '🇳🇬',
  'Papua New Guinea': '🇵🇬', 'Peru': '🇵🇪', 'Philippines': '🇵🇭',
  'Saudi Arabia': '🇸🇦', 'Serbia': '🇷🇸', 'South Africa': '🇿🇦',
  'South Korea': '🇰🇷', 'Spain': '🇪🇸', 'Suriname': '🇸🇷',
  'Sweden': '🇸🇪', 'Tanzania': '🇹🇿', 'Türkiye': '🇹🇷', 'Turkey': '🇹🇷',
  'United Kingdom': '🇬🇧', 'United States': '🇺🇸', 'Zambia': '🇿🇲',
  'Argentina': '🇦🇷', 'Bolivia': '🇧🇴', 'Burkina Faso': '🇧🇫',
  'Cameroon': '🇨🇲', 'Cote d\'Ivoire': '🇨🇮', 'Ethiopia': '🇪🇹',
  'Ghana': '🇬🇭', 'India': '🇮🇳', 'Kazakhstan': '🇰🇿', 'Morocco': '🇲🇦',
  'Mozambique': '🇲🇿', 'Namibia': '🇳🇦', 'Norway': '🇳🇴', 'Oman': '🇴🇲',
  'Pakistan': '🇵🇰', 'Portugal': '🇵🇹', 'Romania': '🇷🇴', 'Russia': '🇷🇺',
  'Senegal': '🇸🇳', 'Zimbabwe': '🇿🇼',
  'Bulgaria': '🇧🇬', 'DR Congo': '🇨🇩', 'Greenland': '🇬🇱',
  'Guinea': '🇬🇳', 'Thailand': '🇹🇭'
};

function getFlag(country) {
  return COUNTRY_FLAGS[country] || '🌐';
}

// Fetch attendees by event code. Paginates past Supabase's 1,000-row default cap
// so events with thousands of registrants (e.g. MFE26) return the complete list.
async function fetchAttendees(eventCode) {
  if (!sb) { console.error('Supabase client not initialized'); return []; }
  try {
    var pageSize = 1000;
    var all = [];
    for (var from = 0; ; from += pageSize) {
      var to = from + pageSize - 1;
      var { data, error } = await sb
        .from('attendees')
        .select('*')
        .eq('event_code', eventCode)
        .order('last_name', { ascending: true })
        .range(from, to);
      if (error) { console.error('Error fetching attendees:', error); break; }
      if (!data || !data.length) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
    }
    return all;
  } catch (err) {
    console.error('fetchAttendees exception:', err);
    return [];
  }
}

// C-Suite job title detection
var CSUITE_PATTERNS = [
  /\bchairm(an|en|person)\b/i,
  /\bexecutive\s+chairman\b/i,
  /\bchief\b/i,
  /\bCEO\b/, /\bCFO\b/, /\bCOO\b/, /\bCTO\b/, /\bCSO\b/,
  /\bmanaging\s+director\b/i,
  /\bfinancial\s+director\b/i
];

// President check: must not be preceded by "Vice" or "Executive Vice" or "Senior Vice"
function isPresident(title) {
  if (!title) return false;
  if (!/\bpresident\b/i.test(title)) return false;
  if (/\bvice[\s\-]president\b/i.test(title)) return false;
  return true;
}

var SENIOR_MGMT_PATTERNS = [
  /\b(EVP|SVP)\b/,
  /\bvice[\s\-]president\b/i,
  /\bexecutive\s+vp\b/i,
  /\bvp\b/i,
  /\bhead\s+of\b/i
];

function isCsuite(jobTitle) {
  if (!jobTitle) return false;
  return CSUITE_PATTERNS.some(function(p) { return p.test(jobTitle); }) || isPresident(jobTitle);
}

function isSeniorMgmt(jobTitle) {
  if (!jobTitle) return false;
  return SENIOR_MGMT_PATTERNS.some(function(p) { return p.test(jobTitle); });
}

// Map attendee country to region
var ATTENDEE_COUNTRY_REGION = {
  'Canada': 'North America', 'United States': 'North America', 'Mexico': 'Latin America',
  'Colombia': 'Latin America', 'Suriname': 'Latin America',
  'United Kingdom': 'Europe', 'France': 'Europe', 'Germany': 'Europe',
  'Switzerland': 'Europe', 'Netherlands': 'Europe', 'Belgium': 'Europe',
  'Spain': 'Europe', 'Italy': 'Europe', 'Norway': 'Europe', 'Denmark': 'Europe',
  'Ireland': 'Europe', 'Estonia': 'Europe', 'Luxembourg': 'Europe',
  'Monaco': 'Europe', 'Liechtenstein': 'Europe',
  'Australia': 'Australasia',
  'South Africa': 'Africa',
  'Hong Kong': 'Asia', 'Singapore': 'Asia', 'India': 'Asia', 'Kazakhstan': 'Asia',
  'Israel': 'Middle East', 'United Arab Emirates': 'Middle East',
  'Türkiye': 'Europe', 'Turkey': 'Europe',
  'Cayman Islands': 'Other'
};

function getAttendeeRegion(country) {
  return ATTENDEE_COUNTRY_REGION[country] || 'Other';
}

// Group data by a field
function groupBy(arr, field) {
  const groups = {};
  arr.forEach(item => {
    const key = item[field] || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return groups;
}

// Sum market cap for an array of companies
function sumMcap(arr) {
  return arr.reduce((s, c) => s + (c.market_cap_usd || 0), 0);
}
