/* THE TEST ENVIRONMENT, SET BEFORE ANY api/ MODULE IS IMPORTED.

   api/_lib/supabase.js builds its client at import time, from process.env. That is right for
   production -- a missing URL there is a misconfigured deployment and should fail at boot --
   but it means the env has to already be set by the time the first api/ import is EVALUATED.

   _book.mjs used to set the defaults in its own body, below its `import ... from '../api/_lib/auth.js'`.
   ESM does not run a module body until all of its imports have been evaluated, so those two
   lines were dead: on a machine with a real .env exported into the shell the suite passed, and
   on a fresh clone all seventeen files that reach api/ died with "supabaseUrl is required" --
   a message that points at Supabase when the fault is here.

   So the defaults live in their own module, and every entry point imports it FIRST. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
