-- Villa Skogstorp – steg 2 av 2: stäng den gamla öppna åtkomsten.
-- Kör FÖRST när alla enheter loggat in med e-post + lösenord och allt fungerar.
-- Tar bort alla regler som släpper in anonyma (anon/public) på vs_items, vs_versions
-- och foton i vs-photos. Därefter krävs inloggning för att läsa eller ändra något.
-- (Publika bildlänkar i vs-photos fungerar fortfarande – de används för foton i planen.)
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('vs_items', 'vs_versions')
      and (roles && array['anon', 'public']::name[])
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    raise notice 'dropped %.% %', p.schemaname, p.tablename, p.policyname;
  end loop;
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (roles && array['anon', 'public']::name[])
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%vs-photos%'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    raise notice 'dropped %.% %', p.schemaname, p.tablename, p.policyname;
  end loop;
end $$;

-- Kontroll: kvarvarande regler (ska bara vara "to authenticated").
select tablename, policyname, roles, cmd from pg_policies
  where (schemaname = 'public' and tablename in ('vs_items', 'vs_versions'))
     or (schemaname = 'storage' and tablename = 'objects')
  order by tablename, policyname;
