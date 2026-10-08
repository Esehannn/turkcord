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

- [x] **6. Günlük kullanım (0.5.0)**: mesaj kopyalama ve sağ tık menüsü, en alta in düğmesi, "yeni mesajlar" çizgisi,
  her tür dosya gönderme (25 MB), bireysel sesli arama ve mehter arama melodisi, ses efektleri, daha belirgin bildirimler
  (ayarlanabilir sesler, uygulama içi kartlar, tepsi rozeti), kendi başlık çubuğu, yükleme iskeletleri

## Sıradaki fikirler

- Sunucuya özel, yüklenebilen ses efektleri (şu an efektler uygulamayla gelen sabit bir set)
- Mesaj arama, sabitlenmiş mesajlar
- Grup aramaları (şu an arama iki kişi arasında; kalabalık için ses kanalları var)

## Dosya alanı

Ücretsiz Supabase planında toplam 1 GB dosya alanı var. Bu yüzden:

- Görseller yüklenmeden önce küçültülür (WebP).
- Diğer dosyalar en fazla 25 MB olabilir.
- 30 günden eski ve 5 MB'tan büyük dosya ekleri, bir yöneticinin uygulaması açıkken günde bir kez silinir
  (**Ayarlar → Yönetici → Depolama**'dan elle de çalıştırılabilir). Mesaj kalır, dosya "artık yok" olarak görünür.

## Bilinçli olarak dışarıda bırakılanlar

Ekran paylaşımı, kamera, mobil uygulama, GIF arama (API anahtarı ister), bağlantı önizleme (ek sunucu ister).
