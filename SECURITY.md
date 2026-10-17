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

- Ses ve görüntü odanın sunucusu (Cloudflare Realtime SFU) üzerinden akar: herkes Cloudflare'e tek bir şifreli
  (WebRTC/DTLS-SRTP) bağlantı kurar, sesini bir kez gönderir, odadakilerin sesini oradan çeker. Supabase'ten geçmez.
  Ses yolda şifrelidir; ama Cloudflare sunucusunda dağıtılmak üzere çözülür, yani uçtan uca şifreli değildir
  (Discord'da da böyledir). Cloudflare teknik olarak sesi ve görüntüyü görebilir.
- Kanaldakiler birbirine bağlanmaz: kimse başkasının IP adresini görmez, adresi yalnızca Cloudflare görür. UDP'nin
  kapalı olduğu ağlarda bağlantı Cloudflare'in aktarma (TURN) sunucusu üzerinden kurulur.
- Cloudflare'le yalnızca `oda` Edge Function'ı konuşur; uygulama anahtarı (App Secret) orada durur. Uygulama başkasının
  Cloudflare oturum kimliğini hiç görmez, kişiyi kullanıcı kimliğiyle ister. Bir sesi ya da görüntüyü yalnızca o
  kanalda kayıtlı oturumu olan ve kanala erişimi süren biri çekebilir; çekilen de aynı kanalda olmalıdır. Oturum
  kayıtları (`private.voice_sessions`) uygulamaya kapalıdır, yalnızca bu fonksiyonun çağırdığı veritabanı işlevleri yazar.
- Susturma durumu, ses efektleri ve görüntü istekleri korumalı Realtime kanallarında gider. Herkes yalnızca kendi
  konusuna (`sinyal:{kanal}:{kullanıcı}`) yazabilir; bunu veritabanı zorlar. Bir olayın kimden geldiğini mesajın içeriği
  değil, geldiği konu belirler: kimse başkası adına durum ya da efekt gönderemez.
- Uygulama yalnızca kanalda görünen (katılımcı listesindeki) kişilerin sesini çeker ve onların olaylarını işler.
  Biri ses oturumu açınca veritabanı bunu `oda:{kanal}` konusuna duyurur (bu konuya kimse yazamaz); duyurulan kişi
  listede görünmüyorsa odadakilere "listede görünmeden bağlandı" uyarısı çıkar.
- Bilinen sınır: odaya normal girip sonra katılımcı listesinden kendini gizleyen (değiştirilmiş bir istemci kullanan)
  biri, Cloudflare'deki bağlantısını kapatmadığı sürece dinlemeye devam edebilir. Sesi Cloudflare dağıttığı için
  yayıncı bunu engelleyemez; 0.8.0'daki kişiden kişiye düzende bu mümkün değildi. Kanaldan çıkarılan ya da sunucudan
  atılan biri yeni bir şey çekemez.
- Bilinen sınır: katılımcı listesi (presence) kişinin kendi bildirdiği kimliğe dayanır. Kanala erişimi olan biri,
  değiştirilmiş bir istemciyle listede başka bir üye gibi görünebilir; ama o üyenin oturumunu kullanamaz, onun adına
  durum ya da efekt gönderemez.
- 0.7.0 ve öncesi sürümler eski düzeni kullanırdı (doğrudan bağlantı, ortak sinyal konusu). O konunun veritabanı
  yetkisi kaldırıldı: bu sürümler, uygulama değiştirilse bile, sesli sohbete bağlanamaz.
- 0.8.0 kişiden kişiye bağlanırdı; 0.9.0 ve sonrasıyla birbirlerini duyamazlar (listede "ESKİ" görünür).
- İsteğe bağlı asgari sürüm (`MIN_APP_VERSION`): sunucu, daha eski sürüme bağlantı bilgisi vermez ve uygulama
  güncelleme ister. Sürümü uygulama kendi bildirdiği için bu, değiştirilmiş bir istemciye karşı koruma değildir;
  güncellemeyi erteleyen kullanıcıyı günceller.
- Cloudflare TURN bilgisi sunucu tarafında kısa ömürlü olarak üretilir; Cloudflare anahtarları Supabase'in gizli ayarlarında durur.
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
- Görüntü (kamera, ekran) de ses gibi yalnızca Cloudflare'den geçer. Yayıncı görüntüsünü ancak biri izlemek isteyince
  gönderir ve onu yalnızca aynı kanalda oturumu olan biri çekebilir.
- Her yerde çalışan kısayollar sadece kullanıcının seçtiği tuş kombinasyonlarını dinler (tuş kaydı yapılmaz);
  ana süreç sadece `Ctrl/Alt/Shift + harf/rakam/F tuşu` biçimindeki kısayolları kabul eder.
- Güncellemeler sadece bu reponun GitHub Releases sayfasından (HTTPS) indirilir; kurulumdan önce dosyanın SHA-512
  özeti `latest.yml` ile karşılaştırılır.
