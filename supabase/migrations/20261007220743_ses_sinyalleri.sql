-- Turkcord 09: sesli sohbet sinyalleri
-- Ses bağlantısı kurulurken taraflar "ses:{kanal}" konusunda bağlantı bilgisi (SDP/ICE) alışverişi yapar.
-- Sadece o ses kanalına erişimi olan (sunucu üyesi) kullanıcılar dinleyebilir ve gönderebilir.
-- Kanalda kimin olduğu ise "chan:{kanal}" konusundaki presence ile izlenir (mevcut kurallar).

create policy "turkcord: ses sinyallerini dinleme"
  on realtime.messages for select
  to authenticated
  using (
    (select realtime.topic()) like 'ses:%'
    and realtime.messages.extension = 'broadcast'
    and private.can_access_channel(private.try_uuid(substr((select realtime.topic()), 5)))
  );

create policy "turkcord: ses sinyali gönderme"
  on realtime.messages for insert
  to authenticated
  with check (
    (select realtime.topic()) like 'ses:%'
    and realtime.messages.extension = 'broadcast'
    and private.can_access_channel(private.try_uuid(substr((select realtime.topic()), 5)))
  );
