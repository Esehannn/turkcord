# Güvenlik

## Açık bildirme

Bir güvenlik açığı bulursan lütfen herkese açık bir issue açma. GitHub'daki
**Security → Report a vulnerability** bölümünden gizli olarak bildir.

## Güvenlik modeli

**Gizli bilgiler**

- Repoda gizli anahtar, şifre ya da token bulunmaz. CI'da her gönderimde `gitleaks` taraması yapılır.
- Uygulama sadece Supabase adresini ve herkese açık (publishable) anahtarı bilir. Bunlar derleme sırasında
  ortam değişkenlerinden okunur (`.env` repoya girmez).
- Service role / secret anahtar sadece Supabase Edge Function'larının çalışma ortamında bulunur.

**Veritabanı**

- Yeni tablolar otomatik olarak dışarı açılmaz; her tabloda RLS açıktır ve her yetki migration'larda tek tek verilir.
- Hassas tablolar (davet kodları, istek sınırları) Data API'de yayınlanmayan `private` şemasındadır.
- Yazma işlemleri kuralları tek yerde toplayan `security definer` fonksiyonlardan geçer. Kullanıcılar sadece izin
  verilen sütunları değiştirebilir (ör. kendini yönetici yapamaz, başkası adına mesaj atamaz).
- Realtime kanalları "private"tır ve `realtime.messages` üzerindeki kurallarla korunur.
- `supabase/tests/rls_test.sql` bu kuralları dört farklı kullanıcıyla uçtan uca dener; CI'da her gönderimde çalışır.

**Kayıt ve giriş**

- Kayıt sadece geçerli bir davet koduyla yapılabilir. Kontrol `auth.users` üzerindeki tetikleyicide zorunludur;
  Edge Function atlanıp doğrudan Auth API'si çağrılsa bile davetsiz hesap oluşturulamaz.
- Kayıt denemeleri IP başına saatte 10 ile sınırlıdır; davet kodları 10 karakterlik rastgele kodlardır (~50 bit).
- Davet kodu olmadan hangi kullanıcı adlarının alındığı yoklanamaz.
- Şifre en az 8 karakter olmalı, harf ve rakam içermeli; yaygın şifreler ve kullanıcı adını içeren şifreler reddedilir.

**Sesli sohbet**

- Ses doğrudan katılımcılar arasında (P2P, WebRTC/DTLS-SRTP ile şifreli) akar; Supabase'ten geçmez.
- Bağlantı bilgisi sadece o ses kanalının sunucusundaki üyeler arasında, korumalı Realtime kanalında paylaşılır.
  P2P'nin doğası gereği aynı ses kanalındaki kişiler birbirinin IP adresini görebilir.
- Cloudflare TURN bilgisi sunucu tarafında kısa ömürlü olarak üretilir; API anahtarı Supabase'in gizli ayarlarında durur.

**Masaüstü uygulaması**

- Pencere `contextIsolation`, `sandbox` açık ve `nodeIntegration` kapalı çalışır; arayüze sadece küçük bir köprü açılır.
- Paketlenmiş uygulamada sıkı bir İçerik Güvenliği Politikası (CSP) vardır; uzak betik yüklenemez.
- Mesajlar asla HTML olarak işlenmez; biçimlendirme güvenli React öğelerine çevrilir.
- Bağlantılar uygulama içinde açılmaz, varsayılan tarayıcıya gönderilir (sadece http/https).
- Oturum anahtarları Windows'un kullanıcıya özel şifrelemesiyle (DPAPI) korunan bir dosyada saklanır.
- Electron Fuses ile `RunAsNode` gibi kötüye kullanılabilecek özellikler kapatılır ve asar bütünlüğü doğrulanır.
- Mikrofon dışında kamera, konum gibi izinler reddedilir.
- Güncellemeler sadece bu reponun GitHub Releases sayfasından (HTTPS) indirilir; kurulumdan önce dosyanın SHA-512
  özeti `latest.yml` ile karşılaştırılır.
