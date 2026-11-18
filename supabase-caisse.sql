-- Al Wasit : la caisse (entrées et sorties d'argent de l'agence), app «Caisse» du téléphone.
-- Dans le MÊME projet Supabase que les clients : SQL Editor → New query → coller tout → Run (une seule fois).
-- Crée seulement le tableau "caisse". Ne touche pas aux clients TLS / BLS.
-- Une ligne = une opération : { sens (in|out), cat, montant, date, mode, client, note, par, cree, by }.

create table if not exists public.caisse (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Seuls les comptes de l'équipe (connectés) peuvent lire / écrire. Personne d'autre.
revoke all on public.caisse from anon;
grant select, insert, update, delete on public.caisse to authenticated;
alter table public.caisse enable row level security;

drop policy if exists "equipe lit caisse" on public.caisse;
drop policy if exists "equipe ajoute caisse" on public.caisse;
drop policy if exists "equipe modifie caisse" on public.caisse;
drop policy if exists "equipe supprime caisse" on public.caisse;
create policy "equipe lit caisse" on public.caisse for select to authenticated using (true);
create policy "equipe ajoute caisse" on public.caisse for insert to authenticated with check (true);
create policy "equipe modifie caisse" on public.caisse for update to authenticated using (true) with check (true);
create policy "equipe supprime caisse" on public.caisse for delete to authenticated using (true);

-- Mises à jour en direct (téléphone et PC).
do $$ begin
  alter publication supabase_realtime add table public.caisse;
exception when duplicate_object then null; end $$;
