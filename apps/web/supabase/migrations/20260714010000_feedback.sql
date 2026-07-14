-- Feedback / contact — a public inbox anyone can submit to (bug reports,
-- suggestions, concerns, or a plain message) and only admins can read/triage.
--
-- Design: submissions are captured directly to this table from the website (no
-- server, no email dependency). Anyone — signed in or not — may INSERT; only
-- admins (see is_admin(), migration 20260714000000) may SELECT/UPDATE/DELETE, so
-- the inbox is private to the owner. Idempotent: safe to re-run.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- What kind of message this is (drives triage + display).
  kind text not null default 'other'
    check (kind in ('bug', 'suggestion', 'concern', 'contact', 'other')),
  -- Optional contact details so the owner can follow up.
  name text,
  email text,
  subject text,
  message text not null check (char_length(message) between 1 and 5000),
  -- Set when a signed-in user submits; null for anonymous submissions.
  user_id uuid references public.users(id) on delete set null,
  -- Where they were + client info, for reproducing bugs.
  page text,
  user_agent text,
  -- Triage state for the admin inbox.
  status text not null default 'new'
    check (status in ('new', 'read', 'resolved'))
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status);

alter table public.feedback enable row level security;

-- The bot / service role can do anything (future: post new feedback to Discord).
drop policy if exists "Service role manages feedback" on public.feedback;
create policy "Service role manages feedback"
  on public.feedback for all to service_role
  using (true) with check (true);

-- Anyone may SUBMIT. A signed-in submitter may only stamp their OWN user_id
-- (or leave it null); anonymous submitters must leave it null — so no one can
-- forge a submission as another user.
drop policy if exists "Anyone can submit feedback (anon)" on public.feedback;
create policy "Anyone can submit feedback (anon)"
  on public.feedback for insert to anon
  with check (user_id is null);

drop policy if exists "Anyone can submit feedback (auth)" on public.feedback;
create policy "Anyone can submit feedback (auth)"
  on public.feedback for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

-- Only admins can read the inbox and change triage status.
drop policy if exists "Admins read feedback" on public.feedback;
create policy "Admins read feedback"
  on public.feedback for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins update feedback" on public.feedback;
create policy "Admins update feedback"
  on public.feedback for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins delete feedback" on public.feedback;
create policy "Admins delete feedback"
  on public.feedback for delete to authenticated
  using (public.is_admin());
