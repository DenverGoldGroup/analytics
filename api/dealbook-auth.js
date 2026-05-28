// POST /api/dealbook-auth — Password auth for public dealbook
var crypto = require('crypto');

var TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret() {
  if (!process.env.DEALBOOK_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return process.env.DEALBOOK_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function generateToken() {
  var secret = getSecret();
  if (!secret) return null;
  var timestamp = String(Date.now());
  var payload = 'dealbook.' + timestamp;
  var signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return payload + '.' + signature;
}

function verifyToken(token) {
  var secret = getSecret();
  if (!secret || !token) return false;
  var parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'dealbook') return false;
  var payload = parts[0] + '.' + parts[1];
  var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  var sigBuf = Buffer.from(parts[2]);
  var expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  var age = Date.now() - parseInt(parts[1], 10);
  if (isNaN(age) || age < 0 || age > TOKEN_TTL) return false;
  return true;
}

// Simple in-memory rate limiting
var attempts = {};
var MAX_ATTEMPTS = 5;
var WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  var now = Date.now();
  var entry = attempts[ip];
  if (!entry) return false;
  if (now - entry.firstAttempt > WINDOW_MS) { delete attempts[ip]; return false; }
  return entry.count >= MAX_ATTEMPTS;
}
function recordAttempt(ip) {
  var now = Date.now();
  if (!attempts[ip] || now - attempts[ip].firstAttempt > WINDOW_MS) {
    attempts[ip] = { count: 1, firstAttempt: now };
  } else { attempts[ip].count++; }
}
function clearAttempts(ip) { delete attempts[ip]; }

var ALLOWED_ORIGINS = [
  'https://dealbook.miningforum.com',
  'https://analytics.miningforum.com'
];

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: verify existing token
  if (req.method === 'GET') {
    var token = req.query.token;
    if (!token) return res.status(400).json({ ok: false, error: 'Token required' });
    var valid = verifyToken(token);
    return res.status(200).json({ ok: valid });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!getSecret()) {
    console.error('FATAL: DEALBOOK_PASSWORD or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  var ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many login attempts. Please try again later.' });
  }

  var body = req.body || {};
  var password = body.password;

  if (!password || typeof password !== 'string') {
    recordAttempt(ip);
    return res.status(401).json({ ok: false, error: 'Password required' });
  }

  // Timing-safe password comparison
  var expected = process.env.DEALBOOK_PASSWORD;
  var pwBuf = Buffer.from(password);
  var expBuf = Buffer.from(expected);

  if (pwBuf.length !== expBuf.length || !crypto.timingSafeEqual(pwBuf, expBuf)) {
    recordAttempt(ip);
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }

  clearAttempts(ip);
  var token = generateToken();
  return res.status(200).json({ ok: true, token: token });
};
