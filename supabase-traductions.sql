-- Al Wasit : les traductions (documents à traduire), partagées par Autofill TLS, Autofill BLS et le téléphone.
-- Dans le MÊME projet Supabase que les clients : SQL Editor → New query → coller tout → Run (une seule fois).
-- Crée seulement le tableau "traductions". Ne touche pas aux clients TLS / BLS.
-- Une ligne = un document : { type, client, de, vers, pages, prix, paye, etat, livraison, notes, cree, by }.

create table if not exists public.traductions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Seuls les comptes de l'équipe (connectés) peuvent lire / écrire. Personne d'autre.
revoke all on public.traductions from anon;
grant select, insert, update, delete on public.traductions to authenticated;
alter table public.traductions enable row level security;

drop policy if exists "equipe lit traductions" on public.traductions;
drop policy if exists "equipe ajoute traductions" on public.traductions;
drop policy if exists "equipe modifie traductions" on public.traductions;
drop policy if exists "equipe supprime traductions" on public.traductions;
create policy "equipe lit traductions" on public.traductions for select to authenticated using (true);
create policy "equipe ajoute traductions" on public.traductions for insert to authenticated with check (true);
create policy "equipe modifie traductions" on public.traductions for update to authenticated using (true) with check (true);
create policy "equipe supprime traductions" on public.traductions for delete to authenticated using (true);

-- Mises à jour en direct (téléphone et PC).
do $$ begin
  alter publication supabase_realtime add table public.traductions;
exception when duplicate_object then null; end $$;
