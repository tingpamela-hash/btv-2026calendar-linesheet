drop table if exists pg_temp.btv_anon_storage_hits;
create temporary table btv_anon_storage_hits (hit text);

do $verify$
declare
  bucket text;
  pol record;
  allowed boolean;
  expr text;
begin
  foreach bucket in array ARRAY['creative-marketing']
  loop
    for pol in
      select policyname, qual
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and permissive = 'PERMISSIVE'
        and cmd in ('SELECT', 'ALL')
        and roles && array['anon'::name, 'public'::name]
    loop
      expr := coalesce(pol.qual, 'true');
      begin
        execute
          'select coalesce((' || expr || '), false) from (select '
          || quote_literal(bucket)
          || '::text as bucket_id, null::uuid as id, null::uuid as owner, '
          || quote_literal('marketing/probe.png')
          || '::text as name, '
          || 'null::jsonb as metadata, now() as created_at, now() as updated_at, '
          || 'now() as last_accessed_at, null::text[] as path_tokens, null::text as version, '
          || 'null::text as owner_id, null::jsonb as user_metadata) as probe'
          into allowed;
      exception
        when others then
          insert into btv_anon_storage_hits (hit)
          values (pol.policyname || ' on ' || bucket);
          continue;
      end;
      if allowed then
        insert into btv_anon_storage_hits (hit)
        values (pol.policyname || ' on ' || bucket);
      end if;
    end loop;
  end loop;
end
$verify$;

select coalesce(string_agg(hit, E'\n' order by hit), '') from btv_anon_storage_hits;
