// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node migrate/create-manager.js --email you@example.com --name "Your Name" --handle you --password "..."
//
// THE FIRST ACCOUNT. A freshly created database has no people in it, and the sign-up form on
// the marketplace only ever makes a BUSINESS and its admin -- deliberately, because a manager
// account is the one that can activate vendors, restrict them, set the system settings and
// fire the Email Centre, and that must never be self-service. So the first manager is made
// here, once, by whoever holds the service-role key.
//
// Passwords are scrypt-hashed by the same code the app verifies with (api/_lib/auth.js), so
// there is no path in this repository that puts a readable password in the database.
//
//   --role assistant-manager   makes a limited manager instead of a full one
//   --password -               reads the password from stdin instead of the command line, so it
//                              does not sit in your shell history: echo "s3cret" | node ... --password -
//   --force                    allows a SECOND manager account (the first one is the safe case)
//
// Safe to run twice: an existing email or handle is reported and nothing is written.

import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../api/_lib/password.js';

const args = process.argv.slice(2);
const flag = (name, dflt = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const has = name => args.includes('--' + name);

const readStdin = () => new Promise((res, rej) => {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { s += d; });
  process.stdin.on('end', () => res(s.replace(/\r?\n$/, '')));
  process.stdin.on('error', rej);
});

function die(msg) { console.error('\n  ' + msg + '\n'); process.exit(1); }

const email = flag('email').trim().toLowerCase();
const name = flag('name').trim();
const handle = flag('handle').trim();
const role = flag('role', 'manager').trim();
let password = flag('password');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase -> Project Settings -> API).');
}
if (!email || !name || !handle) {
  die('Usage: node migrate/create-manager.js --email you@example.com --name "Your Name" --handle you --password "..."');
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('That is not a valid email address: ' + email);
if (/\s/.test(handle)) die('The User ID cannot contain spaces: ' + handle);
if (role !== 'manager' && role !== 'assistant-manager') die('--role must be manager or assistant-manager.');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  if (password === '-') password = await readStdin();
  // Same floor the app enforces in users.js, said here rather than discovered at the sign-in box.
  if (!password || password.length < 4) die('--password must be at least 4 characters (or "-" to read it from stdin).');

  const { data: managers, error: e1 } = await db.from('profiles').select('id, email, handle, role').in('role', ['manager', 'assistant-manager']);
  if (e1) die('Could not read profiles: ' + e1.message + '\n  (Has db/schema.sql been run in this project yet?)');
  if (managers.length && !has('force')) {
    console.log('\n  This database already has ' + managers.length + ' manager account(s):');
    for (const m of managers) console.log('    ' + m.handle + '  ' + m.email + '  (' + m.role + ')');
    console.log('\n  Add another one from the app: sign in as a manager -> Users -> Add User.');
    console.log('  Or pass --force if you really mean to create a second one here.\n');
    process.exit(0);
  }

  const { data: clash, error: e2 } = await db.from('profiles').select('id, email, handle').or('email.eq.' + email + ',handle.eq.' + handle);
  if (e2) die('Could not check for an existing account: ' + e2.message);
  if (clash && clash.length) {
    die('That email or User ID is already taken by: ' + clash.map(c => c.handle + ' / ' + c.email).join(', '));
  }

  const { hash, salt } = hashPassword(password);
  const row = {
    email, name, handle, role, vendor_id: null, branch_id: null, active: true,
    profile_photo_url: null, password_hash: hash, password_salt: salt,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await db.from('profiles').insert(row).select('id, email, name, handle, role').single();
  if (error) die('Could not create the account: ' + error.message);

  console.log('\n  Manager account created.');
  console.log('    User ID   ' + data.handle);
  console.log('    Email     ' + data.email);
  console.log('    Role      ' + data.role);
  console.log('\n  Sign in at your deployment with that User ID and the password you just set,');
  console.log('  then change it from My Account.\n');
}

main().catch(e => die(e && e.stack ? e.stack : String(e)));
