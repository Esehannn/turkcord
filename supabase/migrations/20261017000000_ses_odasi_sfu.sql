-- Turkcord 15: ses odası sunucusu (Cloudflare Realtime SFU)
-- Ses ve görüntü artık kişiden kişiye değil, odanın sunucusu üzerinden akar: herkes Cloudflare'e tek bir bağlantı kurar,
-- sesini bir kez gönderir, odadakilerin sesini oradan çeker. Cloudflare'le konuşan tek yer "oda" Edge Function'ıdır;
-- uygulama anahtarı (App Secret) orada durur.
--
-- Bir sesi ya da görüntüyü çekebilmek için çeken kişinin o kanalda kayıtlı bir oturumu olmalı ve kanala erişimi
-- sürmeli; çekilen de aynı kanalda kayıtlı olmalı. Cloudflare oturum kimlikleri yalnızca bu tabloda ve fonksiyonda
-- durur, uygulamaya başkasının oturum kimliği hiç gitmez.
--
-- Biri ses oturumu açınca "oda:{kanal}" konusuna veritabanından bir duyuru gider. Bu konuya kimse yazamaz; uygulama
-- duyurulan kişi katılımcı listesinde görünmüyorsa odadakileri uyarır (listede görünmeden dinlemeye karşı).

create table private.voice_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- ses: mikrofon ve odadakilerin sesi; goruntu: ekran paylaşımı ve kamera (yalnızca gerektiğinde açılır).
  kind text not null constraint voice_sessions_kind check (kind in ('ses', 'goruntu')),
  channel_id uuid not null references public.channels (id) on delete cascade,
  session_id text not null unique constraint voice_sessions_session_format check (session_id ~ '^[0-9a-f]{32,128}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create index voice_sessions_channel on private.voice_sessions (channel_id);

alter table private.voice_sessions enable row level security;
revoke all on private.voice_sessions from public, anon, authenticated;

-- Kişi bu kanalda sese girebilir mi? Sunucuda yalnızca ses kanalları, özel mesajda iki taraf da.
-- (auth.uid() yerine kimlik açıkça verilir: çağıran, kullanıcıyı doğrulamış olan Edge Function'dır.)
create or replace function private.can_join_voice(p_user uuid, p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
     where c.id = p_channel
       and (
         (c.kind = 'voice' and exists (
            select 1 from public.server_members m
             where m.server_id = c.server_id and m.user_id = p_user))
         or
         (c.kind = 'dm' and exists (
            select 1 from public.dm_members d
             where d.channel_id = c.id and d.user_id = p_user))
       )
  );
$$;

revoke all on function private.can_join_voice(uuid, uuid) from public, anon, authenticated;

-- Yeni Cloudflare oturumunu kaydeder. Kişinin aynı türden eski oturumu (başka kanalda bile) yenisiyle değişir.
create or replace function public.sfu_register(p_user uuid, p_channel uuid, p_kind text, p_session text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('ses', 'goruntu') or p_session !~ '^[0-9a-f]{32,128}$' then
    raise exception 'turkcord:invalid_input';
  end if;
  if not private.can_join_voice(p_user, p_channel) then
    raise exception 'turkcord:forbidden';
  end if;
  -- Görüntü yalnızca o kanalın sesindeyken açılır.
  if p_kind = 'goruntu' and not exists (
    select 1 from private.voice_sessions where user_id = p_user and kind = 'ses' and channel_id = p_channel
  ) then
    raise exception 'turkcord:forbidden';
  end if;

  if p_kind = 'ses' then
    -- Başka kanala geçen kişinin eski görüntü oturumu bırakılır.
    delete from private.voice_sessions where user_id = p_user and kind = 'goruntu' and channel_id <> p_channel;
  end if;

  insert into private.voice_sessions (user_id, kind, channel_id, session_id)
  values (p_user, p_kind, p_channel, p_session)
  on conflict (user_id, kind) do update
    set channel_id = excluded.channel_id, session_id = excluded.session_id, created_at = now();

  if p_kind = 'ses' then
    perform realtime.send(jsonb_build_object('user', p_user), 'oturum', 'oda:' || p_channel::text, true);
  end if;
end;
$$;

-- Oturum bu kişinin mi ve kanala erişimi sürüyor mu? Kanalı ve türü döner; değilse hata.
create or replace function public.sfu_session(p_user uuid, p_session text)
returns table (channel_id uuid, kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select v.channel_id, v.kind
      from private.voice_sessions v
     where v.user_id = p_user and v.session_id = p_session
       and private.can_join_voice(p_user, v.channel_id);
  if not found then
    raise exception 'turkcord:not_found';
  end if;
end;
$$;

-- Çağıranın oturumuyla aynı kanalda kayıtlı kişilerin oturumları (çekilecek ses ve görüntü için).
create or replace function public.sfu_targets(p_user uuid, p_session text, p_users uuid[])
returns table (user_id uuid, kind text, session_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_channel uuid;
begin
  select v.channel_id into v_channel
    from private.voice_sessions v
   where v.user_id = p_user and v.session_id = p_session;
  if v_channel is null or not private.can_join_voice(p_user, v_channel) then
    raise exception 'turkcord:not_found';
  end if;
  -- Bir istekte en fazla 20 kişi (oda en fazla 10 kişi, ses + görüntü).
  if coalesce(array_length(p_users, 1), 0) > 20 then
    raise exception 'turkcord:invalid_input';
  end if;

  return query
    select v.user_id, v.kind, v.session_id
      from private.voice_sessions v
     where v.channel_id = v_channel
       and v.user_id = any (p_users)
       and v.user_id <> p_user;
end;
$$;

-- Kanaldan çıkınca oturum kaydı silinir (ses oturumuyla birlikte görüntü oturumu da).
create or replace function public.sfu_unregister(p_user uuid, p_session text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  delete from private.voice_sessions where user_id = p_user and session_id = p_session returning kind into v_kind;
  if v_kind = 'ses' then
    delete from private.voice_sessions where user_id = p_user and kind = 'goruntu';
  end if;
end;
$$;

revoke all on function public.sfu_register(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.sfu_session(uuid, text) from public, anon, authenticated;
revoke all on function public.sfu_targets(uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.sfu_unregister(uuid, text) from public, anon, authenticated;
grant execute on function public.sfu_register(uuid, uuid, text, text) to service_role;
grant execute on function public.sfu_session(uuid, text) to service_role;
grant execute on function public.sfu_targets(uuid, text, uuid[]) to service_role;
grant execute on function public.sfu_unregister(uuid, text) to service_role;

-- "oda:{kanal}": yalnızca veritabanı yazar (yukarıdaki duyuru); kanala erişimi olanlar dinler.
create policy "turkcord: oda duyurularını dinleme"
  on realtime.messages for select
  to authenticated
  using (
    (select realtime.topic()) like 'oda:%'
    and realtime.messages.extension = 'broadcast'
    and private.can_access_channel(private.try_uuid(split_part((select realtime.topic()), ':', 2)))
  );
