alter table public.users
  add column if not exists active_char_key text;

create index if not exists users_active_char_key_idx
  on public.users (active_char_key);
