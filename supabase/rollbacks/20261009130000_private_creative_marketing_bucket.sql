insert into storage.buckets (id, name, public)
values ('creative-marketing', 'creative-marketing', true)
on conflict (id) do update set public = true;

drop policy if exists creative_marketing_read on storage.objects;
create policy creative_marketing_read
  on storage.objects for select
  using (bucket_id = 'creative-marketing');

grant select on storage.objects to anon;
