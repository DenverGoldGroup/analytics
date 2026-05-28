#!/usr/bin/env node
// Usage: node scripts/add-admin-user.js <email> <name> <password>
// Hashes the password with bcrypt and inserts into admin_users via Supabase.
//
// Requires env vars: SUPABASE_SERVICE_ROLE_KEY
// Example:
//   SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/add-admin-user.js alice@denvergold.org "Alice Smith" MySecurePass123

var bcrypt = require('bcryptjs');
var { createClient } = require('@supabase/supabase-js');

var SUPABASE_URL = 'https://ljyogcspkvqgjbiyzfbn.supabase.co';

async function main() {
  var args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node scripts/add-admin-user.js <email> <name> <password>');
    process.exit(1);
  }

  var email = args[0].toLowerCase().trim();
  var name = args[1];
  var password = args[2];

  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var required');
    process.exit(1);
  }

  var hash = await bcrypt.hash(password, 10);
  var sb = createClient(SUPABASE_URL, key);

  var { data, error } = await sb
    .from('admin_users')
    .upsert({ email: email, name: name, password_hash: hash, active: true, updated_at: new Date().toISOString() },
      { onConflict: 'email' })
    .select('id, email, name');

  if (error) {
    console.error('Database error:', error.message);
    process.exit(1);
  }

  console.log('Admin user created/updated:');
  console.log(JSON.stringify(data[0], null, 2));
}

main();
