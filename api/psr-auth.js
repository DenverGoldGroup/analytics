// POST/GET /api/psr-auth — PSR user auth (magic links, user management)
var crypto = require('crypto');
var { createClient } = require('@supabase/supabase-js');

var SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';
var MAGIC_LINK_TTL = 40 * 60 * 1000;       // 40 minutes
var PSR_TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;  // 7 days
var MAGIC_LINK_RATE_LIMIT = 3;              // max requests per window
var MAGIC_LINK_RATE_WINDOW = 15 * 60 * 1000;  // 15 minutes

function getSupabase() {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(SUPABASE_URL, key);
}

function getSecret() {
  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return process.env.ADMIN_PASSWORD + process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Verify admin token (shared pattern with psr.js / auth.js)
function verifyAdminToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var secret = getSecret();
  if (!secret) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  if (parts.length !== 3) return false;
  var tokenBytes = parts[0], timestamp = parts[1], providedSig = parts[2];
  var expectedSig = crypto.createHmac('sha256', secret).update(tokenBytes + '.' + timestamp).digest('hex');
  var sigBuf = Buffer.from(providedSig);
  var expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  var age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
  return true;
}

// Generate PSR session token: psr.<base64url_email>.<role>.<timestamp>.<signature>
function generatePsrToken(email, role) {
  var emailB64 = Buffer.from(email).toString('base64url');
  var timestamp = String(Date.now());
  var payload = 'psr.' + emailB64 + '.' + role + '.' + timestamp;
  var signature = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return payload + '.' + signature;
}

// Fire-and-forget activity log
function logActivity(sb, opts) {
  sb.from('psr_activity_log').insert({
    event_code: opts.event_code || null,
    user_email: opts.email || 'unknown',
    user_role: opts.role || 'unknown',
    action: opts.action,
    detail: opts.detail || null,
    ip_address: opts.ip || null
  }).then(function(r) { if (r.error) console.error('Activity log:', r.error.message); });
}

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
}

module.exports = async function handler(req, res) {
  try {
    var sb = getSupabase();

    // ── GET ─────────────────────────────────────────────
    if (req.method === 'GET') {
      var action = req.query.action;

      // Verify magic link token → return session
      if (action === 'verify') {
        var token = req.query.token;
        if (!token) return res.status(400).json({ ok: false, error: 'Token required' });

        // Atomic: mark as used AND return in one step (prevents TOCTOU race)
        var { data: links, error: lErr } = await sb.from('psr_magic_links')
          .update({ used_at: new Date().toISOString() })
          .eq('token', token).is('used_at', null)
          .select('*');

        var link = (links && links.length) ? links[0] : null;
        if (lErr || !link) return res.status(400).json({ ok: false, error: 'Invalid or expired link' });
        if (new Date(link.expires_at) < new Date()) return res.status(400).json({ ok: false, error: 'Link has expired. Please request a new one.' });

        // Look up user
        var { data: user } = await sb.from('psr_users').select('*').eq('email', link.email).single();
        if (!user) return res.status(400).json({ ok: false, error: 'User account not found' });

        var sessionToken = generatePsrToken(user.email, user.role);
        logActivity(sb, { email: user.email, role: user.role, action: 'login', detail: 'Magic link login', ip: getClientIP(req) });
        return res.status(200).json({
          ok: true,
          token: sessionToken,
          user: { email: user.email, name: user.name, role: user.role }
        });
      }

      // List users (admin only)
      if (action === 'list-users') {
        if (!verifyAdminToken(req.headers.authorization)) {
          return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        var { data, error } = await sb.from('psr_users').select('*').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, users: data });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
    }

    // ── POST ────────────────────────────────────────────
    if (req.method === 'POST') {
      var body = req.body || {};
      var postAction = body.action;

      // Request magic link (public — but email must be a registered user)
      if (postAction === 'request-link') {
        var email = (body.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ ok: false, error: 'Email required' });

        var { data: user } = await sb.from('psr_users').select('id, email, name, role').eq('email', email).single();
        if (!user) return res.status(400).json({ ok: false, error: 'No account found for this email address' });

        // Rate limit: max N magic link requests per email per window
        var windowStart = new Date(Date.now() - MAGIC_LINK_RATE_WINDOW).toISOString();
        var { count: recentCount } = await sb.from('psr_magic_links')
          .select('id', { count: 'exact', head: true })
          .eq('email', email).gte('created_at', windowStart);
        if (recentCount >= MAGIC_LINK_RATE_LIMIT) {
          return res.status(429).json({ ok: false, error: 'Too many login requests. Please try again in 15 minutes.' });
        }

        // Generate token
        var magicToken = crypto.randomBytes(32).toString('hex');
        var expiresAt = new Date(Date.now() + MAGIC_LINK_TTL).toISOString();
        await sb.from('psr_magic_links').insert({ email: email, token: magicToken, expires_at: expiresAt });

        // Build URL — base_url is hardcoded to prevent open redirect attacks
        var baseUrl = 'https://analytics.miningforum.com';
        var redirect = body.redirect || '/psr/MFE26';
        // Validate redirect is a relative path (prevent open redirect via redirect param)
        if (redirect.indexOf('//') >= 0 || redirect.indexOf(':') >= 0) redirect = '/psr/MFE26';
        var magicUrl = baseUrl + '/psr-login?verify=' + magicToken + '&redirect=' + encodeURIComponent(redirect);

        // Send email if Resend is configured
        var emailSent = false;
        if (process.env.RESEND_API_KEY) {
          try {
            var fromEmail = process.env.PSR_FROM_EMAIL || 'Denver Gold Group <noreply@denvergold.org>';
            var emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: fromEmail,
                to: email,
                subject: 'Your Post Show Report Login Link',
                html: '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">' +
                  '<div style="text-align:center;margin-bottom:24px"><img src="https://analytics.miningforum.com/logos/dgg-logo.png" alt="Denver Gold Group" style="height:40px"></div>' +
                  '<h2 style="font-size:18px;color:#1B2631;margin-bottom:8px">Post Show Report Access</h2>' +
                  '<p style="font-size:14px;color:#555;line-height:1.6">Click the button below to sign in and view your report. This link expires in 40 minutes.</p>' +
                  '<div style="text-align:center;margin:24px 0"><a href="' + magicUrl + '" style="display:inline-block;padding:12px 32px;background:#D4A017;color:#fff;font-weight:600;text-decoration:none;border-radius:8px;font-size:14px">Open Report</a></div>' +
                  '<p style="font-size:11px;color:#999;line-height:1.5">If the button doesn\'t work, copy this URL:<br>' + magicUrl + '</p>' +
                  '<hr style="border:none;border-top:1px solid #E0E0E0;margin:24px 0">' +
                  '<p style="font-size:10px;color:#999;text-align:center">Denver Gold Group — Confidential</p></div>'
              })
            });
            emailSent = emailRes.ok;
          } catch (e) {
            console.error('Email send error:', e);
          }
        }

        var result = { ok: true, email_sent: emailSent };
        // Admin callers get the magic URL (for manual sharing)
        if (verifyAdminToken(req.headers.authorization)) {
          result.magic_url = magicUrl;
        }
        return res.status(200).json(result);
      }

      // ── Admin-only actions below ──────────────────────
      if (!verifyAdminToken(req.headers.authorization)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }

      // Add user
      if (postAction === 'add-user') {
        var email = (body.email || '').trim().toLowerCase();
        var name = (body.name || '').trim();
        var role = body.role === 'admin' ? 'admin' : 'viewer';
        if (!email) return res.status(400).json({ ok: false, error: 'Email required' });

        var { data, error } = await sb.from('psr_users').insert({ email: email, name: name, role: role }).select();
        if (error) {
          if (error.code === '23505') return res.status(400).json({ ok: false, error: 'User with this email already exists' });
          return res.status(500).json({ ok: false, error: error.message });
        }
        logActivity(sb, { email: 'admin', role: 'admin', action: 'user-add', detail: 'Added user: ' + email + ' (' + role + ')', ip: getClientIP(req) });
        return res.status(200).json({ ok: true, user: data[0] });
      }

      // Update user
      if (postAction === 'update-user') {
        var updates = {};
        if (body.name != null) updates.name = body.name;
        if (body.role) updates.role = body.role === 'admin' ? 'admin' : 'viewer';
        updates.updated_at = new Date().toISOString();

        var { error } = await sb.from('psr_users').update(updates).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        logActivity(sb, { email: 'admin', role: 'admin', action: 'user-update', detail: 'Updated user id=' + body.id + (body.role ? ' role→' + updates.role : ''), ip: getClientIP(req) });
        return res.status(200).json({ ok: true });
      }

      // Remove user
      if (postAction === 'remove-user') {
        var { error } = await sb.from('psr_users').delete().eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        logActivity(sb, { email: 'admin', role: 'admin', action: 'user-remove', detail: 'Removed user id=' + body.id, ip: getClientIP(req) });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action: ' + postAction });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('PSR Auth error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
