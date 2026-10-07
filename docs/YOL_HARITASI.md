# Yol haritası

## Kararlar

| Konu | Karar |
|---|---|
| Platform | Windows masaüstü (Electron + React + TypeScript) |
| Sunucu | Supabase ücretsiz plan, Frankfurt |
| Ses | P2P WebRTC (ücretsiz). Bağlantı kurulumu Supabase Realtime ile, gerekirse Cloudflare TURN yedeği (ayda 1.000 GB ücretsiz) |
| Kayıt | Sadece davet koduyla; giriş kullanıcı adı + şifre |
| Tema | Kırmızı-beyaz (varsayılan açık), koyu tema seçeneği |
| Dağıtım | Repo herkese açık, kurulum dosyaları GitHub Releases'ta |
| Maliyet | 0 ₺ |

## Aşamalar

- [x] **1. Temel**: Electron iskeleti, tema, davet kodlu kayıt/giriş, profil, yönetici paneli
- [x] **2. Arkadaşlar ve DM**: arkadaşlık istekleri, engelleme, özel mesajlar
- [x] **3. Sunucular**: sunucu kurma, davet, roller, yazı kanalları, tepkiler, görseller, okunmamış takibi
- [x] **4. Ses**: sesli kanallar (P2P), sustur/sağırlaştır, konuşan göstergesi, kişi başı ses ayarı, giriş/çıkış sesleri
- [x] **5. Cilalama**: otomatik güncelleme, sistem tepsisi, Windows açılışında başlatma, bas-konuş, kısayollar,
  yapay zekâ gürültü engelleme, ping göstergesi, sunucu rolleri, @etiket önerisi

## Bilinçli olarak dışarıda bırakılanlar

Ekran paylaşımı, kamera, mobil uygulama, GIF arama (API anahtarı ister), bağlantı önizleme (ek sunucu ister).
