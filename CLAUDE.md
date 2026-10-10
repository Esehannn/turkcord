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

- Uygulamada ses dosyası yok: bildirim sesleri, arama melodisi, ses kanalı işaretleri ve ses efektleri
  `src/renderer/src/lib/sounds.ts`'te sentezlenir. Ses teması mehterdir: yeni bir ses eklerken oradaki `mallet` / `motif`
  yardımcılarını ve "Ceddin Deden" notalarını (Mi karar) kullan.
- Alias (`@/`) kullanmayan saf yardımcılar (`lib/files.ts`, `lib/coalesce.ts`, `lib/format.ts`, `lib/markdown.ts`, `lib/search.ts`) `node --test` ile doğrudan test edilir;
  bu dosyalara alias'lı içe aktarım ekleme.
- Bireysel aramalar ses kanallarıyla aynı motoru kullanır (`voice/engine.ts`, `serverId` null); çaldırma `calls` tablosundan geçer (`voice/call.ts`).
- Görüntü (ekran paylaşımı, kamera) ses bağlantısından geçmez: `voice/video.ts` her izleyici için ayrı, tek yönlü bir bağlantı
  kurar. Ses bağlantısını (`engine.ts`) görüntü için yeniden pazarlık ettirme; ses kopmaları buradan çıkar. Görüntü yalnızca
  onu gösteren ekran açıkken izlenir (`useCameraFeeds`, "İzle" düğmesi).
- Ekran yakalama kaynağını ana süreç verir (`main/capture.ts`): arayüz önce `pickScreen` ile seçimi bildirir, sonra
  `getDisplayMedia` çağırır. Yerelde denerken `--use-fake-device-for-media-stream` ekran yakalamayı da sahtesiyle değiştirir.

## Arayüz

- Menü ve açılır kutular `components/Menu.tsx` ile sayfanın üstüne (portal) çizilir; kaydırılabilir bir listenin içine
  `absolute` kutu koyma, kenarda kesilir.
- İpucu için `title` kullanma; öğeye `data-tip="…"` yaz (`components/Tooltip.tsx` tek dinleyiciyle hepsini çizer).
- Renkleri sabit yazma: vurgu rengi ayarlardan değişir (`--tc-accent`, Tailwind'de `accent`), tonları ondan türetilir.
- Sessize alma ve görünüm tercihleri bu bilgisayarda (`stores/ui.ts`) tutulur, sunucuya gitmez.

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
açılıştaki güncelleme penceresi aynı sayfayı `#guncelleme` ile açar ve uygulamanın kendisini (oturum, Supabase) yüklemez;
yeni IPC kanalı eklerken `isTrustedSender` kontrolü yap.
