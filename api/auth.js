// POST /api/auth — verify admin password, return a session token
const crypto = require('crypto');

// Simple in-memory rate limiting (per serverless instance)
const loginAttempts = {};
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts[ip];
  if (!entry) return false;
  // Clean up expired entries
  if (now - entry.firstAttempt > WINDOW_MS) {
    delete loginAttempts[ip];
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordAttempt(ip) {
  const now = Date.now();
  if (!loginAttempts[ip] || now - loginAttempts[ip].firstAttempt > WINDOW_MS) {
    loginAttempts[ip] = { count: 1, firstAttempt: now };
  } else {
    loginAttempts[ip].count++;
  }
}

function clearAttempts(ip) {
  delete loginAttempts[ip];
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://analytics.miningforum.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('FATAL: ADMIN_PASSWORD environment variable is not set');
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';

  // Rate limit check
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many login attempts. Please try again later.' });
  }

  try {
    const { password } = req.body || {};

    if (!password || typeof password !== 'string') {
      recordAttempt(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    // Timing-safe comparison to prevent timing attacks
    const pwBuf = Buffer.from(password);
    const adminBuf = Buffer.from(adminPassword);
    if (pwBuf.length !== adminBuf.length || !crypto.timingSafeEqual(pwBuf, adminBuf)) {
      recordAttempt(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    // Clear rate limit on successful login
    clearAttempts(ip);

    // Generate a secure random session token
    const tokenBytes = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now().toString();
    const secret = adminPassword + (process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(tokenBytes + '.' + timestamp)
      .digest('hex');

    const token = tokenBytes + '.' + timestamp + '.' + signature;

    return res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ ok: false, error: 'Authentication error' });
  }
};
