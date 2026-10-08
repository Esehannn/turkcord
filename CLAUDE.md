# Turkcord – geliştirme notları

Discord benzeri, davetle girilen Windows masaüstü sohbet uygulaması. Electron + React + TypeScript, sunucu Supabase.
Arayüz metinleri, kod yorumları ve commit mesajları Türkçe.

## Komutlar

- `npm run typecheck`, `npm test` (node:test), `npm run build`
- `npm run test:db` – migration'lar + RLS testleri; boş bir Postgres gerekir (`TEST_DATABASE_URL`)
- Edge Function tip kontrolü: `deno check supabase/functions/*/index.ts`

## Veritabanı kuralları

- Yeni tablolar otomatik dışarı açılmaz: her tabloda RLS aç, `grant`'ları ve fonksiyon `execute` yetkilerini açıkça yaz,
  `anon`'a hiçbir şey verme. Fonksiyonlarda `set search_path = ''` kullan.
- Hassas tablolar `private` şemasına. Yazma işlemleri `security definer` RPC'lerden; hatalar `turkcord:<kod>` biçiminde
  (`src/renderer/src/lib/errors.ts` bunları Türkçeye çevirir).
- Migration'lar Supabase'in GitHub entegrasyonuyla `main` dalından uygulanır. MCP `apply_migration` kullanılırsa,
  oluşan sürüm numarasıyla (`list_migrations`) aynı adlı dosya repoya eklenmeli; yoksa entegrasyon aynı SQL'i tekrar çalıştırır.
- Her şema değişikliğinde `supabase/tests/rls_test.sql`'e test ekle ve `src/renderer/src/lib/database.types.ts`'i güncelle.

## Sesler ve dosyalar

- Uygulamada ses dosyası yok: bildirim sesleri, arama melodisi ve ses efektleri `src/renderer/src/lib/sounds.ts`'te sentezlenir.
- Alias (`@/`) kullanmayan saf yardımcılar (`lib/files.ts`, `lib/format.ts`, `lib/markdown.ts`) `node --test` ile doğrudan test edilir;
  bu dosyalara alias'lı içe aktarım ekleme.
- Bireysel aramalar ses kanallarıyla aynı motoru kullanır (`voice/engine.ts`, `serverId` null); çaldırma `calls` tablosundan geçer (`voice/call.ts`).

## Performans

RAM ve işlemci kullanımı bu projede önceliklidir (arkadaşlar oyun oynarken arkada açık duruyor):

- Ağır şeyleri (video/ses oynatıcı, büyük liste, ağ isteği) ancak gerektiğinde oluştur; "tıklayınca yükle" varsayılandır.
- Sonsuz dönen animasyonları sadece geçici ekranlarda kullan (yükleme, arama); kalıcı arayüzde sonlu tut.
- Yeni bağımlılık eklemeden önce paket boyutuna etkisine bak; `npm run build` çıktısındaki boyutu karşılaştır.

## Ortak kurallar

`src/shared/password.ts` ve `supabase/functions/_shared/password.ts` aynı kalmalı (testi var).
Kullanıcı adı kuralı da `src/shared/username.ts` ile `supabase/functions/_shared/http.ts` arasında ortak.

## Güvenlik

Repoda gizli bilgi olmaz (`.env` git dışı). Mesajlar HTML olarak işlenmez. Electron penceresi sandbox + CSP ile çalışır;
yeni IPC kanalı eklerken `isTrustedSender` kontrolü yap.
