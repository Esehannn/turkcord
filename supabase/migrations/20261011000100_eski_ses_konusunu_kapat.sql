-- Turkcord 14: eski ses sinyal konusunu kapat
-- 0.8.0 ile sinyaller "sinyal:{kanal}:{kullanıcı}" konularına taşındı (bkz. 20261011000000_sinyal_konulari.sql).
-- Ortak "ses:{kanal}" konusunu yalnızca 0.7.0 ve öncesi kullanır; o düzende gönderen kimliği doğrulanmaz, bağlantı
-- doğrudan (P2P) kurulur ve listede görünmeyen biri de bağlanabilir.
-- Bu migration o konunun yetkilerini kaldırır: eski sürümler, uygulama değiştirilse bile, sesli sohbete bağlanamaz.
--
-- DİKKAT: Herkes 0.8.0 ya da sonrasına geçmeden uygulanırsa güncellemeyenler sesli sohbete giremez
-- ("Ses kanalına bağlanılamadı").

drop policy if exists "turkcord: ses sinyallerini dinleme" on realtime.messages;
drop policy if exists "turkcord: ses sinyali gönderme" on realtime.messages;
