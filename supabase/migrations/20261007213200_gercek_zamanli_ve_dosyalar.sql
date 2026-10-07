-- Turkcord 06: gerçek zamanlı kanallar ve dosya depolama
--
-- Realtime: Tüm kanallar "private". Panelde Realtime > Settings > "Allow public access" kapalı olmalı;
-- böylece herkese açık anahtarı bilen biri kanallara giremez. Konu adları:
--   online            -> çevrimiçi durumu (presence), giriş yapan herkes
--   db:{kullanıcı}    -> veritabanı değişiklik akışı (postgres_changes), sadece o kullanıcı
--   chan:{kanal}      -> "yazıyor..." gibi anlık olaylar (broadcast), sadece kanala erişimi olanlar
--
-- Storage:
--   gorseller (herkese açık okuma): u/{kullanıcı}/... avatarlar, s/{sunucu}/... sunucu ikonları
--   ekler (gizli): {kanal}/{kullanıcı}/... mesaj ekleri, sadece kanala erişimi olanlar okuyabilir

-- ---------------------------------------------------------------------------
-- Realtime yetkilendirme
-- ---------------------------------------------------------------------------

create policy "turkcord: çevrimiçi listesini görme"
  on realtime.messages for select
  to authenticated
  using ((select realtime.topic()) = 'online' and realtime.messages.extension = 'presence');

create policy "turkcord: çevrimiçi durumunu yayınlama"
  on realtime.messages for insert
  to authenticated
  with check ((select realtime.topic()) = 'online' and realtime.messages.extension = 'presence');

create policy "turkcord: kendi değişiklik akışını dinleme"
  on realtime.messages for select
  to authenticated
  using ((select realtime.topic()) = 'db:' || (select auth.uid())::text);

create policy "turkcord: kanal olaylarını dinleme"
  on realtime.messages for select
  to authenticated
  using (
    (select realtime.topic()) like 'chan:%'
    and realtime.messages.extension in ('broadcast', 'presence')
    and private.can_access_channel(private.try_uuid(substr((select realtime.topic()), 6)))
  );

create policy "turkcord: kanal olayı gönderme"
  on realtime.messages for insert
  to authenticated
  with check (
    (select realtime.topic()) like 'chan:%'
    and realtime.messages.extension in ('broadcast', 'presence')
    and private.can_access_channel(private.try_uuid(substr((select realtime.topic()), 6)))
  );

-- Veritabanı değişikliklerini dinlenebilir yap. Her istemci sadece RLS'in izin verdiği satırları alır.
alter publication supabase_realtime add table
  public.messages,
  public.message_reactions,
  public.friendships,
  public.servers,
  public.server_members,
  public.channels,
  public.dm_members,
  public.profiles;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('gorseller', 'gorseller', true, 2 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('ekler', 'ekler', false, 8 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create or replace function private.can_manage_image_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (storage.foldername(p_name))[1]
    when 'u' then (storage.foldername(p_name))[2] = (select auth.uid())::text
    when 's' then coalesce(private.member_role(private.try_uuid((storage.foldername(p_name))[2])) in ('owner', 'admin'), false)
    else false
  end
  and array_length(storage.foldername(p_name), 1) = 2
  and p_name not like '%..%';
$$;

revoke all on function private.can_manage_image_path(text) from public;
grant execute on function private.can_manage_image_path(text) to authenticated;

create policy "turkcord: görsel yükleme"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'gorseller' and private.can_manage_image_path(name));

create policy "turkcord: kendi görsellerini listeleme"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'gorseller' and private.can_manage_image_path(name));

create policy "turkcord: görsel silme"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gorseller' and private.can_manage_image_path(name));

create policy "turkcord: ek yükleme"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'ekler'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.can_post(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "turkcord: ek görüntüleme"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'ekler'
    and private.can_access_channel(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "turkcord: kendi ekini silme"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'ekler'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
