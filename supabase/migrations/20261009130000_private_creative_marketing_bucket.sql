insert into storage.buckets (id, name, public)
values ('creative-marketing', 'creative-marketing', false)
on conflict (id) do update set public = false;

drop policy if exists creative_marketing_read on storage.objects;
create policy creative_marketing_read
  on storage.objects for select
  to authenticated
  using (bucket_id = 'creative-marketing' and btv.can_access('global'));

revoke select on storage.objects from anon;
