-- =====================================================================================
-- RUN-ME 003 -- the Android app's releases table.
-- =====================================================================================
-- WHY THIS FILE EXISTS AT ALL. `app_releases` was added to db/schema.sql and never given a
-- RUN-ME of its own, so a fresh database has had it all along and a database created BEFORE it
-- was added never got it. PostgREST refuses the whole query for a table it cannot find --
-- "Could not find the table 'public.app_releases' in the schema cache" -- which is what the
-- Android screen was reporting, and what the public marketplace was going down over, because
-- the payload that builds the shop window also carries the app's download button.
--
-- The code now survives without this table: the marketplace serves normally with no app to
-- download, /download shows its "not published yet" page, and the Android screen says to run
-- this file. Run it and the Download button becomes possible; leave it and nothing breaks.
--
-- HOW TO RUN IT. Supabase -> SQL Editor -> New query -> paste the whole thing -> Run. It is
-- ONE part, unlike RUN-ME-002: nothing here adds a type, so there is nothing that has to be
-- committed before the next statement can use it. Safe to run twice.
-- =====================================================================================

-- The app on a phone is a window onto this website, so ordinary updates need no new APK at
-- all -- a shopkeeper gets them the moment they are deployed. An APK is only ever rebuilt
-- when the address or the WebView allowlist changes, which is rare and deliberate.
--
-- When that does happen the new file goes in the `app-releases` bucket and gets a row here,
-- and /download always sends people to whichever row is current. That is why the printed QR
-- code can be printed once: it points at /download, never at a version.
create table if not exists app_releases (
  id uuid primary key default gen_random_uuid(),
  version_name text not null,                   -- what a person reads: '1.3'
  version_code integer not null,                -- what the phone compares: 4
  file_name text not null,                      -- object name inside the app-releases bucket
  url text not null,                            -- its public URL, stored so /download is one read
  size_bytes bigint,
  notes text,                                   -- what changed, shown on the update notice
  is_current boolean not null default false,    -- exactly one row is true; /download follows it
  published_at timestamptz not null default now(),
  published_by uuid references profiles(id)
);
create unique index if not exists app_releases_version_code_idx on app_releases (version_code);
-- Only one release can be the current one. A partial unique index says so in the database
-- rather than trusting every future code path to remember.
create unique index if not exists app_releases_one_current_idx on app_releases (is_current) where is_current;

-- THAT IS EVERYTHING. The APK itself lives in the `app-releases` storage bucket, which the
-- Settings -> Android app screen uploads to directly; this table only records what landed.
