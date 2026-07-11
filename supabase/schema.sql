-- Matchday: single key/value table for all shared team data.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run).

create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.kv enable row level security;

-- v1 trust model: anyone with the app's URL (i.e. the anon key baked into
-- the site) can read and write the team's data. Fine for a parents' group;
-- see README "Privacy & security" before sharing the link widely.
create policy "anon can read"   on public.kv for select using (true);
create policy "anon can insert" on public.kv for insert with check (true);
create policy "anon can update" on public.kv for update using (true);
create policy "anon can delete" on public.kv for delete using (true);
