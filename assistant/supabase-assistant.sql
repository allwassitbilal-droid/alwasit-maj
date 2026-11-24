-- 🤖 Assistant Telegram : sa petite table (utilisateurs, propositions en attente, mémoire courte).
-- Seule la fonction «assistant» (clé service) y accède : personne d'autre.
create table if not exists public.assistant (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
revoke all on public.assistant from anon, authenticated;
alter table public.assistant enable row level security;
