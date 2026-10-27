-- Fix for 20261027090100: uploading with upsert (replace a logo or photo) also needs SELECT on the object,
-- and the public bucket had no select policy for signed-in members (public URLs do not use policies).
create policy tenant_public_read on storage.objects for select to authenticated
  using (bucket_id = 'tenant-public' and (storage.foldername(name))[1] = app.tenant_id()::text);
