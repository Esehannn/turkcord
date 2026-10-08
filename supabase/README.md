# supabase/

| Klasör / dosya | İçerik |
|---|---|
| `migrations/` | Veritabanı şeması, yetkiler ve RLS kuralları. Sırayla uygulanır. |
| `functions/kayit` | Davet koduyla kayıt (herkese açık, istek sınırlı) |
| `functions/yonetici` | Yönetici işlemleri: şifre sıfırlama, askıya alma, hesap silme, eski dosya eklerini temizleme |
| `functions/_shared` | Fonksiyonların ortak kodu (şifre ve kullanıcı adı kuralları) |
| `tests/` | `npm run test:db` ile çalışan veritabanı güvenlik testleri |
| `config.toml` | Supabase CLI ayarları ve Edge Function tanımları |

`main` dalına gelen yeni migration'ları ve `config.toml`'da tanımlı fonksiyonları Supabase'in GitHub entegrasyonu
canlı projeye uygular. Auth ve Realtime panel ayarları buradan uygulanmaz; bkz. [docs/KURULUM.md](../docs/KURULUM.md).
