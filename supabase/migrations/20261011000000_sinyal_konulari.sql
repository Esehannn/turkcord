-- Turkcord 13: gönderen kimliği doğrulanan ses sinyalleri
-- Eski düzende herkes ortak "ses:{kanal}" konusuna yazıyordu ve sinyali kimin gönderdiği mesajın içindeki bir
-- alandan okunuyordu; yani kanala erişimi olan biri başkası adına sinyal gönderebilirdi.
-- Yeni düzende herkes yalnızca kendi konusuna yazar: "sinyal:{kanal}:{kullanıcı}". Kanala erişimi olanlar dinler.
-- Bir sinyalin kimden geldiğini artık konu adı belirler ve bunu veritabanı zorlar (uygulama: voice/engine.ts).
--
-- Eski "ses:%" kuralları burada bilerek kaldırılmıyor: 0.7.0 ve öncesi sürümler güncellenene kadar kendi
-- aralarında çalışmaya devam eder. Herkes güncelleyince ayrı bir migration ile kaldırılır.

create policy "turkcord: sinyal konularını dinleme"
  on realtime.messages for select
  to authenticated
  using (
    (select realtime.topic()) like 'sinyal:%'
    and realtime.messages.extension = 'broadcast'
    and private.can_access_channel(private.try_uuid(split_part((select realtime.topic()), ':', 2)))
  );

-- Konu adı tam olarak "sinyal:{kanal}:{kendi kimliğim}" olmalı.
create policy "turkcord: yalnızca kendi sinyal konusuna yazma"
  on realtime.messages for insert
  to authenticated
  with check (
    (select realtime.topic()) = 'sinyal:' || split_part((select realtime.topic()), ':', 2) || ':' || (select auth.uid())::text
    and realtime.messages.extension = 'broadcast'
    and private.can_access_channel(private.try_uuid(split_part((select realtime.topic()), ':', 2)))
  );
