insert into storage.buckets (id, name, public)
values ('casino-logos', 'casino-logos', true)
on conflict (id) do nothing;

create policy "Public can view casino logos"
  on storage.objects for select
  using (bucket_id = 'casino-logos');

create policy "Authenticated users can upload casino logos"
  on storage.objects for insert
  with check (bucket_id = 'casino-logos' and auth.role() = 'authenticated');

create policy "Users can update their own casino logos"
  on storage.objects for update
  using (bucket_id = 'casino-logos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own casino logos"
  on storage.objects for delete
  using (bucket_id = 'casino-logos' and auth.uid()::text = (storage.foldername(name))[1]);
