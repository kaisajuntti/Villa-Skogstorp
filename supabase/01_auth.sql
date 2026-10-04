-- Villa Skogstorp – steg 1 av 2: inloggning (Supabase Auth) + behörigheter.
-- Kör i Supabase → SQL Editor EFTER att användarna skapats (Authentication → Users).
-- Ofarlig att köra flera gånger. Tar INTE bort de gamla öppna (anon) reglerna –
-- det gör 02_lockdown.sql när alla enheter har loggat in med den nya inloggningen.

-- 1. Behörighet per användare (app_metadata kan bara sättas av admin, inte av användaren).
--    'edit' = får ändra, 'view' = bara läsa. Användare utan access kommer inte åt något.
--    Byt e-postadresserna nedan till de konton du skapat.
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"access":"edit"}'
  where email in ('DIN-EPOST@example.com', 'CLAUDE-KONTO@example.com');
-- update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"access":"view"}'
--   where email in ('LÄSARE@example.com');

-- 2. Hjälpfunktion: inloggad användares behörighet ('' om ingen).
create or replace function public.vs_access() returns text
  language sql stable
  as $$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'access', '') $$;

-- 3. Tabellerna: inloggade med behörighet.
alter table public.vs_items enable row level security;
alter table public.vs_versions enable row level security;

drop policy if exists vs_items_auth_select on public.vs_items;
drop policy if exists vs_items_auth_insert on public.vs_items;
drop policy if exists vs_items_auth_update on public.vs_items;
drop policy if exists vs_items_auth_delete on public.vs_items;
create policy vs_items_auth_select on public.vs_items for select to authenticated
  using (public.vs_access() in ('edit', 'view'));
create policy vs_items_auth_insert on public.vs_items for insert to authenticated
  with check (public.vs_access() = 'edit');
create policy vs_items_auth_update on public.vs_items for update to authenticated
  using (public.vs_access() = 'edit') with check (public.vs_access() = 'edit');
create policy vs_items_auth_delete on public.vs_items for delete to authenticated
  using (public.vs_access() = 'edit');

drop policy if exists vs_versions_auth_select on public.vs_versions;
drop policy if exists vs_versions_auth_insert on public.vs_versions;
create policy vs_versions_auth_select on public.vs_versions for select to authenticated
  using (public.vs_access() in ('edit', 'view'));
-- (versionstriggern skriver hit när en inloggad användare uppdaterar vs_items)
create policy vs_versions_auth_insert on public.vs_versions for insert to authenticated
  with check (public.vs_access() = 'edit');

-- 4. Foton (bucket vs-photos, publik läsning som förut): uppladdning/radering kräver inloggning.
drop policy if exists vs_photos_auth_insert on storage.objects;
drop policy if exists vs_photos_auth_delete on storage.objects;
create policy vs_photos_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vs-photos' and public.vs_access() = 'edit');
create policy vs_photos_auth_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vs-photos' and public.vs_access() = 'edit');

-- 5. Ny PRIVAT bucket för känsliga dokument (kontrakt, KA-handlingar, bilagor).
--    Inget är publikt – filer nås bara inloggad, via tidsbegränsade länkar.
insert into storage.buckets (id, name, public) values ('vs-docs', 'vs-docs', false)
  on conflict (id) do update set public = false;
drop policy if exists vs_docs_auth_select on storage.objects;
drop policy if exists vs_docs_auth_insert on storage.objects;
drop policy if exists vs_docs_auth_delete on storage.objects;
create policy vs_docs_auth_select on storage.objects for select to authenticated
  using (bucket_id = 'vs-docs' and public.vs_access() in ('edit', 'view'));
create policy vs_docs_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vs-docs' and public.vs_access() = 'edit');
create policy vs_docs_auth_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vs-docs' and public.vs_access() = 'edit');

-- Kontroll: vilka har behörighet?
select email, raw_app_meta_data ->> 'access' as access, last_sign_in_at from auth.users order by email;
