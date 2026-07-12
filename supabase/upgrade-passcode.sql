-- ————————————————————————————————————————————————
-- Matchday upgrade: team passcode 🔐
--
-- BEFORE RUNNING: change 'CHANGE-ME' below to your team's passcode.
-- Pick three words joined with dashes, e.g. 'orange-whistle-42'.
-- Use letters, numbers and dashes only (parents will type it once).
--
-- Run the whole file in the Supabase SQL editor. From the moment it
-- runs, all reads/writes require the passcode — so run it just before
-- you push the matching app update, not on match day.
--
-- TO CHANGE THE PASSCODE LATER (e.g. if it leaks): re-run just the
-- first statement with a new value. Every parent's app will prompt
-- for the new code automatically.
-- ————————————————————————————————————————————————

create or replace function public.team_pass_ok()
returns boolean
language sql
stable
as $$
  select (current_setting('request.headers', true)::json ->> 'x-matchday-pass') = 'CHANGE-ME';
$$;

-- Lets the app verify a typed passcode and give a friendly
-- "that's not it" message, instead of just silently seeing no data.
create or replace function public.check_pass()
returns boolean
language sql
stable
as $$
  select public.team_pass_ok();
$$;

grant execute on function public.team_pass_ok() to anon;
grant execute on function public.check_pass() to anon;

-- Replace the open-to-anyone policies with passcode-gated ones.
drop policy if exists "anon can read"   on public.kv;
drop policy if exists "anon can insert" on public.kv;
drop policy if exists "anon can update" on public.kv;
drop policy if exists "anon can delete" on public.kv;

create policy "pass can read"   on public.kv for select using (public.team_pass_ok());
create policy "pass can insert" on public.kv for insert with check (public.team_pass_ok());
create policy "pass can update" on public.kv for update using (public.team_pass_ok()) with check (public.team_pass_ok());
create policy "pass can delete" on public.kv for delete using (public.team_pass_ok());
