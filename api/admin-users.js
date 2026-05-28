// GET/POST /api/admin-users — Admin user management (super_admin only)
var crypto = require('crypto');
var { createClient } = require('@supabase/supabase-js');
var bcrypt = require('bcryptjs');

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

// Verify admin token and return { email, role } — supports 4-part (JSON payload) and 3-part (legacy)
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  var secret = getSecret();
  if (!secret) return false;
  var token = authHeader.replace('Bearer ', '');
  var parts = token.split('.');
  var payloadB64, providedSig, payload;
  if (parts.length === 4) {
    payloadB64 = parts[2]; providedSig = parts[3];
    payload = parts[0] + '.' + parts[1] + '.' + payloadB64;
  } else if (parts.length === 3) {
    payloadB64 = ''; providedSig = parts[2];
    payload = parts[0] + '.' + parts[1];
  } else { return false; }
  var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  var sigBuf = Buffer.from(providedSig);
  var expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  var age = Date.now() - parseInt(parts[1], 10);
  if (isNaN(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
  if (!payloadB64) return { email: 'admin', role: 'super_admin' };
  try {
    var info = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    return { email: info.email || 'admin', role: info.role || 'admin' };
  } catch (e) {
    // Old 4-part token with plain email (pre-JSON era) — shared-password users are super_admin
    return { email: Buffer.from(payloadB64, 'base64').toString('utf8'), role: 'super_admin' };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://analytics.miningforum.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // All actions require super_admin
    var auth = verifyToken(req.headers.authorization);
    if (!auth) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (auth.role !== 'super_admin') {
      return res.status(403).json({ ok: false, error: 'Requires super_admin role' });
    }

    var sb = getSupabase();

    // ── GET ─────────────────────────────────────────────
    if (req.method === 'GET') {
      var action = req.query.action;

      // List all admin users
      if (action === 'list') {
        var { data, error } = await sb.from('admin_users')
          .select('id, email, name, role, active, created_at, updated_at')
          .order('created_at', { ascending: true });
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, users: data });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
    }

    // ── POST ────────────────────────────────────────────
    if (req.method === 'POST') {
      var body = req.body || {};
      var postAction = body.action;

      // Create user
      if (postAction === 'create') {
        var email = (body.email || '').trim().toLowerCase();
        var name = (body.name || '').trim();
        var role = body.role === 'super_admin' ? 'super_admin' : 'admin';
        var password = body.password || '';

        if (!email) return res.status(400).json({ ok: false, error: 'Email required' });
        if (!password || password.length < 8) {
          return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
        }

        var hash = await bcrypt.hash(password, 10);
        var { data, error } = await sb.from('admin_users')
          .insert({ email: email, name: name, password_hash: hash, role: role, active: true })
          .select('id, email, name, role, active, created_at');

        if (error) {
          if (error.code === '23505') return res.status(400).json({ ok: false, error: 'A user with this email already exists' });
          return res.status(500).json({ ok: false, error: error.message });
        }
        return res.status(200).json({ ok: true, user: data[0] });
      }

      // Update user (name, role)
      if (postAction === 'update') {
        if (!body.id) return res.status(400).json({ ok: false, error: 'User id required' });
        var updates = { updated_at: new Date().toISOString() };
        if (body.name != null) updates.name = body.name.trim();
        if (body.role) updates.role = body.role === 'super_admin' ? 'super_admin' : 'admin';
        var { error } = await sb.from('admin_users').update(updates).eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Reset password
      if (postAction === 'reset-password') {
        if (!body.id) return res.status(400).json({ ok: false, error: 'User id required' });
        var newPw = body.password || '';
        if (!newPw || newPw.length < 8) {
          return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
        }
        var hash = await bcrypt.hash(newPw, 10);
        var { error } = await sb.from('admin_users')
          .update({ password_hash: hash, updated_at: new Date().toISOString() })
          .eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Toggle active status
      if (postAction === 'toggle-active') {
        if (!body.id) return res.status(400).json({ ok: false, error: 'User id required' });
        // Don't allow deactivating yourself
        var { data: targetUser } = await sb.from('admin_users')
          .select('email, active').eq('id', body.id).single();
        if (!targetUser) return res.status(404).json({ ok: false, error: 'User not found' });
        if (targetUser.email === auth.email) {
          return res.status(400).json({ ok: false, error: 'Cannot deactivate your own account' });
        }
        var { error } = await sb.from('admin_users')
          .update({ active: !targetUser.active, updated_at: new Date().toISOString() })
          .eq('id', body.id);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        return res.status(200).json({ ok: true, active: !targetUser.active });
      }

      // Send magic link via email
      if (postAction === 'send-magic-link') {
        var email = (body.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ ok: false, error: 'Email required' });

        // Verify user exists and is active
        var { data: user } = await sb.from('admin_users')
          .select('id, email, name, active').eq('email', email).single();
        if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
        if (!user.active) return res.status(400).json({ ok: false, error: 'User account is disabled' });

        // Generate magic link token
        var magicToken = crypto.randomBytes(32).toString('hex');
        var tokenHash = crypto.createHash('sha256').update(magicToken).digest('hex');
        var expiresAt = new Date(Date.now() + MAGIC_LINK_TTL).toISOString();

        await sb.from('admin_magic_links').insert({
          email: email,
          token_hash: tokenHash,
          expires_at: expiresAt
        });

        var magicUrl = 'https://analytics.miningforum.com/admin?magic=' + magicToken;

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
                subject: 'Your Admin Login Link — Mining Forum Analytics',
                html: '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px">' +
                  '<div style="text-align:center;margin-bottom:24px"><img src="https://analytics.miningforum.com/logos/dgg-logo.png" alt="Denver Gold Group" style="height:40px"></div>' +
                  '<h2 style="font-size:18px;color:#1B2631;margin-bottom:8px">Admin Login</h2>' +
                  '<p style="font-size:14px;color:#555;line-height:1.6">Hi ' + (user.name || email) + ', click the button below to sign in to the Data Center. This link expires in 30 minutes.</p>' +
                  '<div style="text-align:center;margin:24px 0"><a href="' + magicUrl + '" style="display:inline-block;padding:12px 32px;background:#D4A017;color:#fff;font-weight:600;text-decoration:none;border-radius:8px;font-size:14px">Sign In</a></div>' +
                  '<p style="font-size:11px;color:#999;line-height:1.5">If the button doesn\'t work, copy this URL:<br>' + magicUrl + '</p>' +
                  '<hr style="border:none;border-top:1px solid #E0E0E0;margin:24px 0">' +
                  '<p style="font-size:10px;color:#999;text-align:center">Denver Gold Group — Confidential</p></div>'
              })
            });
            emailSent = emailRes.ok;
          } catch (e) {
            console.error('Magic link email error:', e);
          }
        }

        return res.status(200).json({
          ok: true,
          email_sent: emailSent,
          magic_url: magicUrl
        });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action: ' + postAction });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin users error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
