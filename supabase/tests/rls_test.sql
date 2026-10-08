-- Turkcord veritabanı güvenlik testleri.
-- Dört kullanıcı (ali, veli, ayse, mehmet) ile erişim kurallarını uçtan uca dener.
-- `npm run test:db` boş bir Postgres'e önce supabase_stubs.sql'i, sonra tüm migration'ları, en son bu dosyayı uygular.

\set ON_ERROR_STOP on
\set ali    '11111111-1111-4111-8111-111111111111'
\set veli   '22222222-2222-4222-8222-222222222222'
\set ayse   '33333333-3333-4333-8333-333333333333'
\set mehmet '44444444-4444-4444-8444-444444444444'

create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.ok(cond boolean, msg text)
returns void
language plpgsql
as $$
begin
  if cond is distinct from true then
    raise exception 'BAŞARISIZ: %', msg;
  end if;
  raise notice 'ok - %', msg;
end;
$$;

-- Verilen SQL'in hata vermesini bekler. `expected` verilirse hata mesajında geçmesi gerekir.
create function tests.fails(stmt text, msg text, expected text default null)
returns void
language plpgsql
as $$
declare
  err text;
begin
  begin
    execute stmt;
  exception when others then
    err := sqlerrm;
    if expected is not null and position(expected in err) = 0 then
      raise exception 'BAŞARISIZ: % (beklenen hata "%", gelen "%")', msg, expected, err;
    end if;
    raise notice 'ok - % [%]', msg, err;
    return;
  end;
  raise exception 'BAŞARISIZ: % (hata bekleniyordu)', msg;
end;
$$;

create function tests.login(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;

create function tests.topic(p_topic text)
returns void
language sql
as $$
  select set_config('realtime.topic', p_topic, false);
$$;

grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. Kayıt: davet kodu zorunlu
-- ---------------------------------------------------------------------------

insert into private.invites (code, max_uses, grants_admin) values ('KURUCU2026', 1, true);
insert into private.invites (code, max_uses) values ('ARKADAS777', 3);
insert into private.invites (code, max_uses, expires_at) values ('ESKIKOD123', 5, now() - interval '1 hour');

select tests.fails(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.invalid', '{"username":"xkisi"}')$$,
  'davet kodu olmadan kayıt olunamaz', 'turkcord:invalid_invite');
select tests.fails(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.invalid', '{"username":"xkisi","invite_code":"YANLISKOD1"}')$$,
  'yanlış davet koduyla kayıt olunamaz', 'turkcord:invalid_invite');
select tests.fails(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.invalid', '{"username":"xkisi","invite_code":"ESKIKOD123"}')$$,
  'süresi dolmuş davet koduyla kayıt olunamaz', 'turkcord:invalid_invite');
select tests.fails(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.invalid', '{"username":"Büyük Harf","invite_code":"ARKADAS777"}')$$,
  'geçersiz kullanıcı adıyla kayıt olunamaz', 'turkcord:invalid_username');

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ali', 'ali@test.invalid', '{"username":"ali","display_name":"Ali Kurucu","invite_code":"kurucu-2026"}');
insert into auth.users (id, email, raw_user_meta_data) values
  (:'veli', 'veli@test.invalid', '{"username":"veli","display_name":"Veli","invite_code":"ARKADAS777"}'),
  (:'ayse', 'ayse@test.invalid', '{"username":"ayse","display_name":"Ayşe","invite_code":"ARKADAS777"}'),
  (:'mehmet', 'mehmet@test.invalid', '{"username":"mehmet","display_name":"Mehmet","invite_code":"ARKADAS777"}');

select tests.fails(
  $$insert into auth.users (email, raw_user_meta_data) values ('x@test.invalid', '{"username":"xkisi","invite_code":"ARKADAS777"}')$$,
  'kullanım hakkı biten davet koduyla kayıt olunamaz', 'turkcord:invalid_invite');
select tests.fails(
  $$insert into auth.users (email, raw_user_meta_data) values ('y@test.invalid', '{"username":"veli","invite_code":"KURUCU2026"}')$$,
  'alınmış kullanıcı adıyla kayıt olunamaz', 'turkcord:username_taken');

select tests.ok((select count(*) = 4 from public.profiles), 'davetli dört kullanıcının profili oluştu');
select tests.ok((select is_admin from public.profiles where username = 'ali'), 'kurucu davetiyle gelen yönetici oldu');
select tests.ok((select not is_admin from public.profiles where username = 'veli'), 'normal davetle gelen yönetici değil');
select tests.ok((select display_name = 'Ayşe' from public.profiles where username = 'ayse'), 'görünen ad Türkçe karakterle kaydedildi');
select tests.ok(
  (select bool_and(not (raw_user_meta_data ? 'invite_code')) from auth.users),
  'davet kodu kullanıcı verisinde saklanmıyor');
select tests.ok((select uses = 3 from private.invites where code = 'ARKADAS777'), 'davet kullanım sayısı arttı');
select tests.ok(public.check_registration('yeni_kisi', 'kurucu2026') = 'invalid_invite', 'ön kontrol: kullanılmış kod');
select tests.ok(public.check_registration('veli', 'x') = 'invalid_invite', 'ön kontrol: kodu olmayan kullanıcı adlarını yoklayamaz');
select tests.ok(public.check_registration('veli', 'kurucu2026') = 'invalid_invite', 'ön kontrol: kullanılmış kodla ad yoklanamaz');
insert into private.invites (code, max_uses) values ('YOKLAMA123', 1);
select tests.ok(public.check_registration('veli', 'YOKLAMA123') = 'username_taken', 'ön kontrol: geçerli kodla alınmış ad bildirilir');
select tests.ok(public.check_registration('yeni.kisi', 'YOKLAMA123') = 'ok', 'ön kontrol: geçerli kod ve boş ad');
select tests.ok((select bool_and(public.hit_rate_limit('test:ip', 3, 3600)) from generate_series(1, 3)), 'istek sınırı: ilk 3 deneme serbest');
select tests.ok(not public.hit_rate_limit('test:ip', 3, 3600), 'istek sınırı: 4. deneme engellenir');

-- ---------------------------------------------------------------------------
-- 2. Profiller ve yönetici işlemleri
-- ---------------------------------------------------------------------------

select tests.login(:'veli');
set role authenticated;

select tests.ok((select count(*) = 4 from public.profiles), 'giriş yapan kullanıcı profilleri görebilir');
select tests.fails($$select * from private.invites$$, 'davet kodları tablosu okunamaz', 'permission denied');
select tests.fails($$select public.admin_create_invite(1, 24, null)$$, 'yönetici olmayan davet kodu üretemez', 'turkcord:forbidden');
select tests.fails($$select public.admin_list_invites()$$, 'yönetici olmayan davetleri listeleyemez', 'turkcord:forbidden');
select tests.fails($$select public.check_registration('a', 'b')$$, 'kayıt ön kontrolü sadece sunucu tarafında', 'permission denied');
select tests.fails($$select public.hit_rate_limit('x', 1, 1)$$, 'istek sınırı fonksiyonu sadece sunucu tarafında', 'permission denied');
select tests.fails($$update public.profiles set is_admin = true where id = auth.uid()$$, 'kullanıcı kendini yönetici yapamaz', 'permission denied');
select tests.fails($$update public.profiles set username = 'baska' where id = auth.uid()$$, 'kullanıcı adı değiştirilemez', 'permission denied');

update public.profiles set display_name = 'Veli Usta', custom_status = 'Çay demleniyor' where id = auth.uid();
update public.profiles set display_name = 'Hacklendi' where username = 'ayse';
select tests.ok((select display_name = 'Veli Usta' from public.profiles where username = 'veli'), 'kendi profilini düzenledi');
select tests.ok((select display_name = 'Ayşe' from public.profiles where username = 'ayse'), 'başkasının profili değişmedi');
select tests.fails(
  format('update public.profiles set avatar_path = %L where id = auth.uid()', 'u/' || :'ayse' || '/a.webp'),
  'başkasının klasöründeki görsel avatar yapılamaz', 'profiles_avatar_path_owner');

reset role;
select tests.login(:'ali');
set role authenticated;

select tests.ok(length(public.admin_create_invite(2, 24, 'kuzenler için')) = 10, 'yönetici davet kodu üretebilir');
select tests.ok((select count(*) >= 4 from public.admin_list_invites()), 'yönetici davetleri listeleyebilir');
select tests.fails(format('select public.admin_set_admin(%L, false)', :'ali'), 'son yönetici yetkisini bırakamaz', 'turkcord:last_admin');

-- ---------------------------------------------------------------------------
-- 3. Arkadaşlık
-- ---------------------------------------------------------------------------

reset role;
select tests.login(:'veli');
set role authenticated;

select tests.ok(public.send_friend_request('ayse') = 'sent', 'veli ayşeye istek gönderdi');
select tests.fails($$select public.send_friend_request('ayse')$$, 'aynı istek iki kez gönderilemez', 'turkcord:already_sent');
select tests.fails($$select public.send_friend_request('veli')$$, 'kendine istek gönderilemez', 'turkcord:self');
select tests.fails($$select public.send_friend_request('olmayan')$$, 'olmayan kullanıcıya istek gönderilemez', 'turkcord:user_not_found');
select tests.fails($$insert into public.friendships (requester_id, addressee_id) values (auth.uid(), auth.uid())$$, 'arkadaşlık tablosuna doğrudan yazılamaz', 'permission denied');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from public.friendships), 'mehmet başkalarının arkadaşlığını göremez');

reset role;
select tests.login(:'ayse');
set role authenticated;
select tests.ok((select count(*) = 1 from public.friendships where status = 'pending'), 'ayşe bekleyen isteği görüyor');
select tests.ok(public.send_friend_request('veli') = 'accepted', 'karşılıklı istek arkadaşlığı onaylar');

-- ---------------------------------------------------------------------------
-- 4. DM'ler
-- ---------------------------------------------------------------------------

reset role;
select tests.login(:'veli');
set role authenticated;

select public.get_or_create_dm(:'ayse') as dm_id \gset
select tests.ok(public.get_or_create_dm(:'ayse') = :'dm_id'::uuid, 'aynı kişiyle tek DM kanalı açılır');
insert into public.messages (channel_id, content) values (:'dm_id', 'Selam Ayşe, çay var mı?');
select tests.ok((select count(*) = 1 from public.list_dms()), 'veli DM listesinde ayşeyi görüyor');

reset role;
select tests.login(:'ayse');
set role authenticated;
select tests.ok((select count(*) = 1 from public.messages where channel_id = :'dm_id'), 'ayşe DM mesajını okuyabiliyor');
select tests.ok((select unread = 1 from public.unread_counts() where channel_id = :'dm_id'), 'ayşe için 1 okunmamış mesaj');
select public.mark_channel_read(:'dm_id');
select tests.ok(not exists (select 1 from public.unread_counts() where channel_id = :'dm_id'), 'okundu işaretlenince sayaç sıfırlandı');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from public.messages where channel_id = :'dm_id'), 'mehmet başkalarının DMini okuyamaz');
select tests.ok((select count(*) = 0 from public.channels where id = :'dm_id'), 'mehmet DM kanalını göremez');
select tests.fails(
  format('insert into public.messages (channel_id, content) values (%L, %L)', :'dm_id', 'araya giriyorum'),
  'mehmet başkalarının DMine yazamaz', 'row-level security');
select tests.fails(format('select public.mark_channel_read(%L)', :'dm_id'), 'erişemediği kanalı okundu yapamaz', 'turkcord:forbidden');

-- Engelleme
reset role;
select tests.login(:'ayse');
set role authenticated;
select public.block_user(:'veli');
select tests.ok((select count(*) = 0 from public.friendships), 'engelleyince arkadaşlık kalktı');

reset role;
select tests.login(:'veli');
set role authenticated;
select tests.fails(
  format('insert into public.messages (channel_id, content) values (%L, %L)', :'dm_id', 'neden engelledin'),
  'engellenen kişi DM atamaz', 'row-level security');
select tests.fails($$select public.send_friend_request('ayse')$$, 'engellenen kişi istek gönderemez', 'turkcord:blocked');
select tests.ok((select count(*) = 0 from public.blocks), 'veli kendisini kimin engellediğini göremez');

reset role;
select tests.login(:'ayse');
set role authenticated;
select public.unblock_user(:'veli');

-- ---------------------------------------------------------------------------
-- 5. Sunucular ve kanallar
-- ---------------------------------------------------------------------------

reset role;
select tests.login(:'ali');
set role authenticated;

select public.create_server('Kahve Köşesi') as server_id \gset
select tests.ok((select count(*) = 3 from public.channels where server_id = :'server_id'), 'yeni sunucuda 3 varsayılan kanal var');
select id as genel_id from public.channels where server_id = :'server_id' and name = 'genel' \gset
select id as ses_id from public.channels where server_id = :'server_id' and kind = 'voice' \gset
insert into public.messages (channel_id, content) values (:'genel_id', 'Hoş geldiniz @veli');
select public.create_server_invite(:'server_id', null, 24) as davet \gset

reset role;
select tests.login(:'veli');
set role authenticated;
select tests.ok((select count(*) = 0 from public.servers where id = :'server_id'), 'üye olmayan sunucuyu göremez');
select tests.ok((select count(*) = 0 from public.messages where channel_id = :'genel_id'), 'üye olmayan kanal mesajlarını okuyamaz');
select tests.fails(format('select public.create_server_invite(%L)', :'server_id'), 'üye olmayan davet oluşturamaz', 'turkcord:forbidden');
select tests.ok((select name = 'Kahve Köşesi' and member_count = 1 from public.preview_server_invite(lower(:'davet'))), 'davet önizlemesi sunucuyu gösteriyor');
select tests.fails($$select public.join_server('YANLIS99')$$, 'yanlış sunucu daveti çalışmaz', 'turkcord:invalid_invite');
select tests.ok(public.join_server(:'davet') = :'server_id'::uuid, 'veli davetle sunucuya katıldı');
select tests.ok((select count(*) = 3 from public.channels where server_id = :'server_id'), 'üye kanalları görüyor');
select tests.ok((select count(*) = 1 from public.messages where channel_id = :'genel_id'), 'üye kanal mesajlarını okuyor');
select tests.ok(not exists (select 1 from public.unread_counts() where channel_id = :'genel_id'), 'katılmadan önceki mesajlar okunmamış sayılmaz');
select tests.fails(format('select public.create_channel(%L, %L, %L)', :'server_id', 'gizli', 'text'), 'üye kanal açamaz', 'turkcord:forbidden');
update public.servers set name = 'Ele Geçirildi' where id = :'server_id';
select tests.ok((select name = 'Kahve Köşesi' from public.servers where id = :'server_id'), 'üye sunucu adını değiştiremez');
select tests.fails(
  format('insert into public.messages (channel_id, content) values (%L, %L)', :'ses_id', 'ses kanalına yazı'),
  'ses kanalına yazı yazılamaz', 'row-level security');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from public.server_members where server_id = :'server_id'), 'üye olmayan üye listesini göremez');
select tests.ok((select count(*) = 0 from public.server_invites), 'üye olmayan davet kodlarını göremez');

-- Roller
reset role;
select tests.login(:'ali');
set role authenticated;
select public.set_member_role(:'server_id', :'veli', 'admin');
select public.join_server(:'davet');

reset role;
select tests.login(:'veli');
set role authenticated;
select tests.ok(public.create_channel(:'server_id', 'oyun', 'text') is not null, 'yönetici kanal açabilir');
select tests.fails(format('select public.kick_member(%L, %L)', :'server_id', :'ali'), 'yönetici sahibi atamaz', 'turkcord:forbidden');
select tests.fails(format('select public.set_member_role(%L, %L, %L)', :'server_id', :'veli', 'member'), 'sadece sahip rol değiştirebilir', 'turkcord:forbidden');
delete from public.servers where id = :'server_id';
select tests.ok((select count(*) = 1 from public.servers where id = :'server_id'), 'yönetici sunucuyu silemez');

-- Özel roller (adlı, renkli)
select public.create_server_role(:'server_id', ' Çaycı ', '#1A7F37') as rol_id \gset
select tests.ok((select name = 'Çaycı' and color = '#1a7f37' from public.server_roles where id = :'rol_id'), 'yönetici rol oluşturabilir');
select tests.fails(format('select public.create_server_role(%L, %L, %L)', :'server_id', 'x', 'kırmızı'), 'geçersiz renk reddedilir', 'turkcord:invalid_input');
select tests.fails(format('select public.create_server_role(%L, %L, %L)', :'server_id', '   ', '#ffffff'), 'boş rol adı reddedilir', 'turkcord:invalid_input');
select tests.fails(
  format('insert into public.server_roles (server_id, name) values (%L, %L)', :'server_id', 'Doğrudan'),
  'rol tablosuna doğrudan yazılamaz', 'permission denied');
select public.set_member_server_role(:'server_id', :'veli', :'rol_id');
select tests.ok((select role_id = :'rol_id'::uuid from public.server_members where server_id = :'server_id' and user_id = :'veli'), 'yönetici üyeye rol verebilir');
select tests.fails(format('select public.set_member_server_role(%L, %L, %L)', :'server_id', :'ali', :'rol_id'), 'yönetici sahibin rolünü değiştiremez', 'turkcord:forbidden');
select tests.fails(
  format('update public.server_members set role_id = null where server_id = %L and user_id = %L', :'server_id', :'veli'),
  'üye tablosundaki rol doğrudan değiştirilemez', 'permission denied');
select public.update_server_role(:'rol_id', 'Baş Çaycı', '#c2410c', 3);
select tests.ok((select name = 'Baş Çaycı' and position = 3 from public.server_roles where id = :'rol_id'), 'yönetici rolü düzenleyebilir');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from public.server_roles where server_id = :'server_id'), 'üye olmayan sunucu rollerini göremez');
select tests.fails(format('select public.create_server_role(%L, %L, %L)', :'server_id', 'Sızma', '#000000'), 'üye olmayan rol oluşturamaz', 'turkcord:forbidden');
select tests.fails(format('select public.delete_server_role(%L)', :'rol_id'), 'üye olmayan rol silemez', 'turkcord:forbidden');
select tests.fails(format('select public.set_member_server_role(%L, %L, %L)', :'server_id', :'veli', null), 'üye olmayan rol veremez', 'turkcord:forbidden');

reset role;
select tests.login(:'ali');
set role authenticated;
select public.create_server('Deneme') as deneme_id \gset
select tests.fails(format('select public.set_member_server_role(%L, %L, %L)', :'deneme_id', :'ali', :'rol_id'), 'başka sunucunun rolü verilemez', 'turkcord:invalid_input');
delete from public.servers where id = :'deneme_id';
select public.set_member_server_role(:'server_id', :'ali', :'rol_id');
select public.delete_server_role(:'rol_id');
select tests.ok((select count(*) = 0 from public.server_members where server_id = :'server_id' and role_id is not null), 'rol silinince üyelerden de kalkar');

reset role;
select tests.login(:'veli');
set role authenticated;

-- ---------------------------------------------------------------------------
-- 6. Mesaj düzenleme, silme ve tepkiler
-- ---------------------------------------------------------------------------

insert into public.messages (channel_id, content) values (:'genel_id', 'Veli buradaydı') returning id as veli_msg \gset
select id as ali_msg from public.messages where channel_id = :'genel_id' and content like 'Hoş geldiniz%' \gset

select tests.fails(
  format('insert into public.messages (channel_id, content, author_id) values (%L, %L, %L)', :'genel_id', 'sahte', :'ali'),
  'başkası adına mesaj atılamaz', 'permission denied');
select tests.fails(
  format('insert into public.messages (channel_id, content) values (%L, %L)', :'genel_id', '   '),
  'boş mesaj atılamaz', 'messages_not_empty');
select tests.fails(
  format('insert into public.messages (channel_id, content, attachments) values (%L, %L, %L)', :'genel_id', 'ek',
         jsonb_build_array(jsonb_build_object('path', :'genel_id' || '/' || :'ali' || '/x.webp'))),
  'başkasının klasöründeki dosya eklenemez', 'turkcord:invalid_attachments');
insert into public.messages (channel_id, content, attachments)
values (:'genel_id', '', jsonb_build_array(jsonb_build_object('path', :'genel_id' || '/' || :'veli' || '/foto.webp', 'width', 10, 'height', 10)));

update public.messages set content = 'Veli buradaydı (düzeltildi)' where id = :'veli_msg';
select tests.ok((select edited_at is not null from public.messages where id = :'veli_msg'), 'düzenlenen mesajda düzenlendi işareti var');
update public.messages set content = 'değiştirdim' where id = :'ali_msg';
select tests.ok((select content like 'Hoş geldiniz%' from public.messages where id = :'ali_msg'), 'başkasının mesajı düzenlenemez');
select tests.fails(format('update public.messages set channel_id = %L where id = %L', :'dm_id', :'veli_msg'), 'mesaj başka kanala taşınamaz', 'permission denied');

insert into public.message_reactions (message_id, emoji) values (:'ali_msg', '☕');
select tests.fails(
  format('insert into public.message_reactions (message_id, emoji, user_id) values (%L, %L, %L)', :'ali_msg', '🔥', :'ali'),
  'başkası adına tepki verilemez', 'permission denied');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from public.message_reactions), 'üye olmayan tepkileri göremez');
select tests.fails(
  format('insert into public.message_reactions (message_id, emoji) values (%L, %L)', :'ali_msg', '👀'),
  'üye olmayan tepki veremez', 'row-level security');

reset role;
select tests.login(:'ali');
set role authenticated;
select tests.ok((select count(*) = 1 from public.message_reactions where message_id = :'ali_msg'), 'üye tepkiyi görüyor');
select tests.ok((select unread = 2 and mentions = 0 and server_id = :'server_id' from public.unread_counts() where channel_id = :'genel_id'), 'ali için 2 okunmamış mesaj (sunucu bilgisiyle)');
delete from public.messages where id = :'veli_msg';
select tests.ok((select count(*) = 0 from public.messages where id = :'veli_msg'), 'sunucu sahibi başkasının mesajını silebilir');
insert into public.messages (channel_id, content) values (:'genel_id', '@Veli kanala bak');

reset role;
select tests.login(:'veli');
set role authenticated;
select tests.ok((select unread = 1 and mentions = 1 from public.unread_counts() where channel_id = :'genel_id'), 'etiketlenme sayılıyor');

-- ---------------------------------------------------------------------------
-- 7. Realtime kanal yetkileri
-- ---------------------------------------------------------------------------

reset role;
insert into realtime.messages (topic, extension, payload) values
  ('chan:' || :'genel_id', 'broadcast', '{"t":"yaziyor"}'),
  ('online', 'presence', '{}'),
  ('db:' || :'veli', 'postgres_changes', '{}');

select tests.login(:'veli');
select tests.topic('chan:' || :'genel_id');
set role authenticated;
select tests.ok((select count(*) = 1 from realtime.messages where topic = realtime.topic()), 'üye kanal olaylarını dinleyebilir');
insert into realtime.messages (topic, extension) values ('chan:' || :'genel_id', 'broadcast');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from realtime.messages where topic = realtime.topic()), 'üye olmayan kanal olaylarını dinleyemez');
select tests.fails(
  format('insert into realtime.messages (topic, extension) values (%L, %L)', 'chan:' || :'genel_id', 'broadcast'),
  'üye olmayan kanala olay gönderemez', 'row-level security');

reset role;
select tests.topic('chan:bozuk-konu');
set role authenticated;
select tests.ok((select count(*) = 0 from realtime.messages where topic = realtime.topic()), 'bozuk konu adı hata vermeden reddedilir');

reset role;
select tests.topic('db:' || :'veli');
set role authenticated;
select tests.ok((select count(*) = 0 from realtime.messages where topic = realtime.topic()), 'mehmet velinin değişiklik akışını dinleyemez');

reset role;
select tests.login(:'veli');
set role authenticated;
select tests.ok((select count(*) = 1 from realtime.messages where topic = realtime.topic()), 'veli kendi değişiklik akışını dinleyebilir');

reset role;
select tests.topic('online');
set role authenticated;
select tests.ok((select count(*) = 1 from realtime.messages where topic = realtime.topic()), 'giriş yapan herkes çevrimiçi listesini görebilir');

-- Ses sinyalleri
reset role;
insert into realtime.messages (topic, extension, payload) values ('ses:' || :'ses_id', 'broadcast', '{"t":"teklif"}');
select tests.login(:'veli');
select tests.topic('ses:' || :'ses_id');
set role authenticated;
select tests.ok((select count(*) = 1 from realtime.messages where topic = realtime.topic()), 'üye ses sinyallerini alabilir');
insert into realtime.messages (topic, extension) values ('ses:' || :'ses_id', 'broadcast');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from realtime.messages where topic = realtime.topic()), 'üye olmayan ses sinyallerini alamaz');
select tests.fails(
  format('insert into realtime.messages (topic, extension) values (%L, %L)', 'ses:' || :'ses_id', 'broadcast'),
  'üye olmayan ses sinyali gönderemez', 'row-level security');

reset role;
set role anon;
select tests.fails($$select count(*) from realtime.messages$$, 'giriş yapmamış biri kanallara erişemez', 'permission denied');
select tests.fails($$select count(*) from public.profiles$$, 'giriş yapmamış biri profilleri okuyamaz', 'permission denied');
select tests.fails($$select public.create_server('x')$$, 'giriş yapmamış biri fonksiyon çağıramaz', 'permission denied');

-- ---------------------------------------------------------------------------
-- 8. Dosya depolama
-- ---------------------------------------------------------------------------

reset role;
select tests.login(:'veli');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('gorseller', 'u/' || :'veli' || '/avatar-1.webp');
select tests.fails(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'gorseller', 'u/' || :'ayse' || '/avatar.webp'),
  'başkasının avatar klasörüne yüklenemez', 'row-level security');
insert into storage.objects (bucket_id, name) values ('gorseller', 's/' || :'server_id' || '/ikon.webp');
insert into storage.objects (bucket_id, name) values ('ekler', :'genel_id' || '/' || :'veli' || '/foto.webp');
select tests.fails(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ekler', :'genel_id' || '/' || :'ali' || '/foto.webp'),
  'başkası adına ek yüklenemez', 'row-level security');
select tests.fails(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'gorseller', 'u/' || :'veli' || '/../x.webp'),
  'yol atlatma denemesi reddedilir', 'row-level security');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from storage.objects where bucket_id = 'ekler'), 'üye olmayan ekleri göremez');
select tests.fails(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'gorseller', 's/' || :'server_id' || '/ikon2.webp'),
  'üye olmayan sunucu ikonu yükleyemez', 'row-level security');
select tests.fails(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'ekler', :'genel_id' || '/' || :'mehmet' || '/x.webp'),
  'üye olmayan kanala ek yükleyemez', 'row-level security');

reset role;
select tests.login(:'ali');
set role authenticated;
select tests.ok((select count(*) = 1 from storage.objects where bucket_id = 'ekler'), 'kanal üyesi ekleri görebilir');
select tests.ok((select count(*) >= 1 from public.admin_storage_usage()), 'yönetici depolama kullanımını görebilir');

-- ---------------------------------------------------------------------------
-- 9. Dosya ekleri ve bireysel aramalar
-- ---------------------------------------------------------------------------

reset role;
select tests.ok(
  (select file_size_limit = 25 * 1024 * 1024 and allowed_mime_types is null from storage.buckets where id = 'ekler'),
  'ekler kovası her tür dosyayı 25 MB sınırıyla kabul ediyor');

select tests.login(:'veli');
set role authenticated;
insert into public.messages (channel_id, content, attachments)
values (:'genel_id', '', jsonb_build_array(jsonb_build_object(
  'path', :'genel_id' || '/' || :'veli' || '/rapor.pdf', 'name', 'rapor.pdf', 'type', 'application/pdf', 'size', 1234)));
select tests.fails(
  format('insert into public.messages (channel_id, content, attachments) values (%L, %L, %L)', :'genel_id', '',
         jsonb_build_array(jsonb_build_object('path', :'genel_id' || '/' || :'veli' || '/x.bin', 'name', repeat('a', 201)))),
  'çok uzun dosya adı reddedilir', 'turkcord:invalid_attachments');
select tests.fails(
  format('insert into public.messages (channel_id, content, kind) values (%L, %L, %L)', :'dm_id', 'missed', 'call'),
  'kullanıcı sahte arama kaydı ekleyemez', 'permission denied');
select tests.fails($$select * from public.admin_storage_usage()$$, 'yönetici olmayan depolama kullanımını göremez', 'turkcord:forbidden');
select tests.fails($$select * from public.stale_attachments(30, 0)$$, 'temizlik listesi sadece sunucu tarafında', 'permission denied');

select tests.fails(format('select public.start_call(%L)', :'genel_id'), 'sunucu kanalında arama başlatılamaz', 'turkcord:forbidden');
select public.start_call(:'dm_id') as call_id \gset
select tests.fails(format('select public.start_call(%L)', :'dm_id'), 'çalan arama varken yenisi başlatılamaz', 'turkcord:busy');
select tests.fails(format('select public.answer_call(%L, true)', :'call_id'), 'arayan kendi aramasını cevaplayamaz', 'turkcord:not_found');
select tests.fails(
  format('insert into public.calls (channel_id, caller_id, callee_id) values (%L, %L, %L)', :'dm_id', :'veli', :'ayse'),
  'arama tablosuna doğrudan yazılamaz', 'permission denied');
select tests.fails(
  format('update public.calls set status = %L where id = %L', 'accepted', :'call_id'),
  'arama durumu doğrudan değiştirilemez', 'permission denied');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from public.calls), 'mehmet başkalarının aramasını göremez');
select tests.fails(format('select public.start_call(%L)', :'dm_id'), 'mehmet başkalarının DMinde arama başlatamaz', 'turkcord:forbidden');
select tests.fails(format('select public.answer_call(%L, true)', :'call_id'), 'mehmet başkasının aramasını cevaplayamaz', 'turkcord:not_found');
select public.end_call(:'call_id');

reset role;
select tests.login(:'ayse');
set role authenticated;
select tests.ok((select status = 'ringing' from public.calls where id = :'call_id'), 'başkası aramayı kapatamaz; ayşe çalan aramayı görüyor');
select public.answer_call(:'call_id', true);
select tests.ok((select status = 'accepted' and answered_at is not null from public.calls where id = :'call_id'), 'ayşe aramayı açtı');

reset role;
select tests.login(:'veli');
set role authenticated;
select public.end_call(:'call_id');
select tests.ok((select status = 'ended' and ended_at is not null from public.calls where id = :'call_id'), 'veli görüşmeyi bitirdi');
select tests.ok(
  (select count(*) = 1 from public.messages where channel_id = :'dm_id' and kind = 'call' and content like 'ended:%' and author_id = :'veli'),
  'biten görüşme sohbete süresiyle kaydedildi');
select tests.fails(
  format('update public.messages set content = %L where channel_id = %L and kind = %L', 'ended:99999', :'dm_id', 'call'),
  'arama kaydı düzenlenemez', 'turkcord:forbidden');
select public.start_call(:'dm_id') as call2_id \gset
select public.end_call(:'call2_id');
select tests.ok((select status = 'missed' from public.calls where id = :'call2_id'), 'arayan vazgeçince arama cevapsız sayılır');

reset role;
select tests.login(:'ayse');
set role authenticated;
select tests.ok(
  (select unread >= 1 from public.unread_counts() where channel_id = :'dm_id'),
  'cevapsız arama okunmamış olarak görünüyor');
select public.start_call(:'dm_id') as call3_id \gset

reset role;
select tests.login(:'veli');
set role authenticated;
select public.answer_call(:'call3_id', false);
select tests.ok((select status = 'declined' from public.calls where id = :'call3_id'), 'aranan aramayı reddedebilir');
select tests.ok(
  (select count(*) = 1 from public.messages where channel_id = :'dm_id' and kind = 'call' and content = 'declined' and author_id = :'ayse'),
  'reddedilen arama sohbete kaydedildi');

-- Arama odası (presence)
reset role;
insert into realtime.messages (topic, extension, payload) values ('ara:' || :'dm_id', 'presence', '{}');
select tests.login(:'veli');
select tests.topic('ara:' || :'dm_id');
set role authenticated;
select tests.ok((select count(*) = 1 from realtime.messages where topic = realtime.topic()), 'DM üyesi arama odasını görebilir');
insert into realtime.messages (topic, extension) values ('ara:' || :'dm_id', 'presence');

reset role;
select tests.login(:'mehmet');
set role authenticated;
select tests.ok((select count(*) = 0 from realtime.messages where topic = realtime.topic()), 'mehmet arama odasını göremez');
select tests.fails(
  format('insert into realtime.messages (topic, extension) values (%L, %L)', 'ara:' || :'dm_id', 'presence'),
  'mehmet arama odasına katılamaz', 'row-level security');

-- Engelleme varken arama yapılamaz
reset role;
select tests.login(:'ayse');
set role authenticated;
select public.block_user(:'veli');

reset role;
select tests.login(:'veli');
set role authenticated;
select tests.fails(format('select public.start_call(%L)', :'dm_id'), 'engellenen kişi arayamaz', 'turkcord:forbidden');

reset role;
\echo 'Tüm veritabanı testleri geçti.'
