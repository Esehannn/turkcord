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

- Ses katılımcılar arasında uçtan uca şifreli (WebRTC/DTLS-SRTP) akar ve yalnızca Cloudflare'in aktarma (TURN)
  sunucusundan geçer; Supabase'ten geçmez. Cloudflare şifreli paketleri iletir, içeriğini çözemez.
- Doğrudan (P2P) bağlantı kurulmaz (`iceTransportPolicy: 'relay'`): uygulama yerel ya da genel IP adresini karşı tarafa
  hiç bildirmez, kanaldaki kişiler birbirinin değil Cloudflare'in adresini görür. Aktarma sunucusuna ulaşılamazsa
  kanala girilmez; doğrudan bağlantıya geri dönülmez.
- Bağlantı bilgisi (sinyal) sadece o ses kanalına erişimi olanlar arasında, korumalı Realtime kanallarında paylaşılır.
  Herkes yalnızca kendi konusuna (`sinyal:{kanal}:{kullanıcı}`) yazabilir; bunu veritabanı zorlar. Bir sinyalin kimden
  geldiğini mesajın içeriği değil, geldiği konu belirler: kimse başkası adına bağlantı kuramaz, durum ya da efekt
  gönderemez.
- Ses ve görüntü bağlantısı yalnızca kanalda görünen (katılımcı listesindeki) kişilerle kurulur: yalnızca
  listedekilerin konusu dinlenir, listeden çıkanın bağlantısı hemen kapanır. Kimin dinlediği ve izlediği her zaman
  listede görünür.
- Bilinen sınır: katılımcı listesi (presence) kişinin kendi bildirdiği kimliğe dayanır. Kanala erişimi olan biri,
  değiştirilmiş bir istemciyle listede başka bir üye gibi görünebilir; ama o üyenin konusuna yazamadığı için onun
  adına bağlantı kuramaz, yani bu yolla ses ya da görüntü alamaz.
- 0.7.0 ve öncesi sürümler eski düzeni kullanır (doğrudan bağlantı, ortak sinyal konusu) ve bu korumaların hiçbirine
  sahip değildir; güncel sürümdekilerle sesli konuşamazlar. Eski düzenin veritabanı yetkisi, herkes güncelleyince
  kaldırılır.
- İsteğe bağlı asgari sürüm (`MIN_APP_VERSION`): sunucu, daha eski sürüme aktarma bilgisi vermez ve uygulama
  güncelleme ister. Sürümü uygulama kendi bildirdiği için bu, değiştirilmiş bir istemciye karşı koruma değildir;
  güncellemeyi erteleyen kullanıcıyı günceller.
- Cloudflare TURN bilgisi sunucu tarafında kısa ömürlü olarak üretilir; API anahtarı Supabase'in gizli ayarlarında durur.
- Bireysel aramalar sadece özel mesajın iki tarafı arasında başlatılabilir; engelleme varsa arama yapılamaz. Arama
  kayıtlarını (`calls`) sadece taraflar görür ve durumları sadece sunucudaki fonksiyonlar değiştirir (dakikada en fazla 6 arama).
- Ses efektlerinde ses verisi gönderilmez, sadece "şu efekti çal" sinyali gider; alıcı sadece bilinen efekt adlarını,
  o an kanalda olan kişilerden ve sınırlı sıklıkta kabul eder.

**Dosya ekleri**

- Ekler gizli bir kovada durur; sadece o kanala erişimi olanlar kısa ömürlü imzalı bağlantıyla okuyabilir.
- Dosyalar uygulamanın içinde çalıştırılmaz ve açılmaz: görsel, ses ve video dışındakiler sadece indirilebilir (indirme
  varsayılan tarayıcıda yapılır). SVG görsel olarak gösterilmez; HTML/betik türleri düz ikili veri olarak saklanır.
- Dosya adı, türü ve yolu veritabanında doğrulanır; bir kullanıcı başkasının klasöründeki dosyayı mesajına ekleyemez.

**Masaüstü uygulaması**

- Pencere `contextIsolation`, `sandbox` açık ve `nodeIntegration` kapalı çalışır; arayüze sadece küçük bir köprü açılır.
- Paketlenmiş uygulamada sıkı bir İçerik Güvenliği Politikası (CSP) vardır; uzak betik yüklenemez. `wasm-unsafe-eval`
  sadece uygulamanın içindeki gürültü engelleme modelinin (WebAssembly) derlenmesine izin verir; `eval` kapalıdır.
- Mesajlar asla HTML olarak işlenmez; biçimlendirme güvenli React öğelerine çevrilir.
- Bağlantılar uygulama içinde açılmaz, varsayılan tarayıcıya gönderilir (sadece http/https).
- Oturum anahtarları Windows'un kullanıcıya özel şifrelemesiyle (DPAPI) korunan bir dosyada saklanır.
- Electron Fuses ile `RunAsNode` gibi kötüye kullanılabilecek özellikler kapatılır ve asar bütünlüğü doğrulanır.
- Yalnızca mikrofon, kamera ve ekran paylaşımı izinleri verilir; konum gibi diğer izinler reddedilir.
- Ekran yakalama yalnızca kullanıcının uygulamanın kendi seçim penceresinde seçtiği ekrana ya da pencereye verilir.
  Seçim tek kullanımlıktır; seçim yapılmadan gelen yakalama isteği ana süreçte reddedilir.
- Görüntü (kamera, ekran) de ses gibi uçtan uca şifreli olarak yalnızca Cloudflare aktarma sunucusundan geçer ve
  yalnızca izlemek isteyen kişiye gönderilir.
- Her yerde çalışan kısayollar sadece kullanıcının seçtiği tuş kombinasyonlarını dinler (tuş kaydı yapılmaz);
  ana süreç sadece `Ctrl/Alt/Shift + harf/rakam/F tuşu` biçimindeki kısayolları kabul eder.
- Güncellemeler sadece bu reponun GitHub Releases sayfasından (HTTPS) indirilir; kurulumdan önce dosyanın SHA-512
  özeti `latest.yml` ile karşılaştırılır.
