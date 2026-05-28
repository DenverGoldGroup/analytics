// POST /api/auth — admin login (email+password or magic link verification)
var crypto = require('crypto');
var bcrypt = require('bcryptjs');
var { createClient } = require('@supabase/supabase-js');

var SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
var MAGIC_LINK_TTL = 30 * 60 * 1000; // 30 minutes

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

function getSecret() {
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Simple in-memory rate limiting (per serverless instance)
var loginAttempts = {};
var MAX_ATTEMPTS = 5;
var WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  var now = Date.now();
  var entry = loginAttempts[ip];
  if (!entry) return false;
  if (now - entry.firstAttempt > WINDOW_MS) { delete loginAttempts[ip]; return false; }
  return entry.count >= MAX_ATTEMPTS;
}
function recordAttempt(ip) {
  var now = Date.now();
  if (!loginAttempts[ip] || now - loginAttempts[ip].firstAttempt > WINDOW_MS) {
    loginAttempts[ip] = { count: 1, firstAttempt: now };
  } else { loginAttempts[ip].count++; }
}
function clearAttempts(ip) { delete loginAttempts[ip]; }

// Generate signed session token: randomBytes.timestamp.payload_b64.signature
// payload = JSON { email, role }
function generateToken(user) {
  var secret = getSecret();
  var tokenBytes = crypto.randomBytes(32).toString('hex');
  var timestamp = Date.now().toString();
  var payloadB64 = Buffer.from(JSON.stringify({ email: user.email, role: user.role })).toString('base64');
  var signature = crypto.createHmac('sha256', secret)
    .update(tokenBytes + '.' + timestamp + '.' + payloadB64)
    .digest('hex');
  return tokenBytes + '.' + timestamp + '.' + payloadB64 + '.' + signature;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://analytics.miningforum.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!getSecret()) {
    console.error('FATAL: ADMIN_PASSWORD or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  var ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  var body = req.body || {};
  var action = body.action || 'login';

  try {
    // ── Magic link verification ──
    if (action === 'verify-magic-link') {
      var magicToken = body.token;
      if (!magicToken || typeof magicToken !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing token' });
      }
      var tokenHash = crypto.createHash('sha256').update(magicToken).digest('hex');
      var sb = getSupabase();
      var { data: link } = await sb.from('admin_magic_links')
        .select('*').eq('token_hash', tokenHash).eq('used', false).single();

      if (!link) {
        return res.status(401).json({ ok: false, error: 'Invalid or expired link' });
      }
      if (new Date(link.expires_at) < new Date()) {
        await sb.from('admin_magic_links').update({ used: true }).eq('id', link.id);
        return res.status(401).json({ ok: false, error: 'This link has expired. Please request a new one.' });
      }

      // Mark as used
      await sb.from('admin_magic_links').update({ used: true }).eq('id', link.id);

      // Look up user
      var { data: user } = await sb.from('admin_users')
        .select('id, email, name, role, active')
        .eq('email', link.email).single();

      if (!user || !user.active) {
        return res.status(401).json({ ok: false, error: 'Account not found or disabled' });
      }

      var token = generateToken(user);
      return res.status(200).json({ ok: true, token: token, user: { email: user.email, name: user.name, role: user.role } });
    }

    // ── Email + password login ──
    if (isRateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many login attempts. Please try again later.' });
    }

    var email = body.email;
    var password = body.password;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      recordAttempt(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    var sb = getSupabase();
    var { data: user, error: dbErr } = await sb.from('admin_users')
      .select('id, email, name, password_hash, role, active')
      .eq('email', email.toLowerCase().trim()).single();

    if (dbErr || !user) {
      await bcrypt.compare(password, '$2a$10$dummyhashfortimingxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      recordAttempt(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    if (!user.active) {
      recordAttempt(ip);
      return res.status(401).json({ ok: false, error: 'Account disabled' });
    }

    var passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      recordAttempt(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    clearAttempts(ip);
    var token = generateToken(user);
    return res.status(200).json({ ok: true, token: token, user: { email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ ok: false, error: 'Authentication error' });
  }
};
