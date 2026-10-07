# Kurulum (proje sahibi için)

Bu adımlar bir kere yapılır. Turkcord'u kendi Supabase projenle çalıştırmak isteyen biri de aynı adımları izleyebilir.

## 1. Supabase projesi

1. [supabase.com](https://supabase.com) üzerinde yeni proje aç. Bölge: **Central EU (Frankfurt)**.
2. Oluştururken:
   - **Enable Data API**: açık
   - **Automatically expose new tables**: kapalı
   - **Enable automatic RLS**: açık
3. **Project Settings → Integrations → GitHub**: repoyu bağla.
   - Working directory: `.`
   - Production branch: `main`
   - Deploy to production: **açık**
   - Automatic branching: **kapalı** (ücretli özellik)

`main` dalına gelen migration'lar ve Edge Function'lar otomatik uygulanır.

## 2. Panel ayarları (config.toml'dan uygulanmaz, elle yapılır)

| Yer | Ayar | Değer |
|---|---|---|
| Authentication → Sign In / Providers | Allow new users to sign up | **Kapalı** (kayıt sadece davet koduyla, Edge Function üzerinden) |
| Authentication → Sign In / Providers → Email | Minimum password length | **8** |
| Authentication → Sign In / Providers → Email | Password requirements | **Letters and digits** |
| Realtime → Settings | Allow public access | **Kapalı** |

Davetle kayıt kontrolü veritabanında zorunlu olduğu için ilk ayarı unutmak açık oluşturmaz, ama kapalı olması daha temiz.

## 3. İlk yönetici

İlk hesabı açmak için yönetici yetkisi veren tek kullanımlık bir davet kodu gerekir. Supabase panelinde
**SQL Editor**'de çalıştır (kodu kendin belirle, kimseyle paylaşma):

```sql
insert into private.invites (code, max_uses, grants_admin, note)
values ('KENDIKODUN1', 1, true, 'kurucu');
```

Uygulamada **Kayıt Ol** ekranında bu kodu kullan. Sonraki davet kodlarını uygulamanın içinden
(**Ayarlar → Yönetici → Davet kodları**) üretebilirsin.

## 4. Sürüm çıkarma (Windows kurulum dosyası)

1. GitHub'da repo **Settings → Secrets and variables → Actions → Variables** bölümüne iki değişken ekle:
   - `VITE_SUPABASE_URL` = `https://PROJE-KODUN.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_...` (Project Settings → API Keys)
2. `package.json`'daki sürümü artır, `v0.1.0` gibi bir etiket gönder ya da **Actions → Sürüm → Run workflow** de.
3. Kurulum dosyası **Releases** sayfasına yüklenir.

## 5. Güvenlik önerileri

- Repo herkese açıksa **Settings → Code security** altında *Secret scanning* ve *Push protection*'ı aç.
- `main` dalı için **Settings → Branches** altında koruma kuralı ekle (doğrudan push yerine PR).
- Ücretsiz Supabase projeleri 7 gün hiç kullanılmazsa uykuya geçer; panelden tek tıkla açılır, veri kaybolmaz.
