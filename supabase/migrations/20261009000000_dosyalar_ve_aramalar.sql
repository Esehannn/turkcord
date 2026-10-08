-- Turkcord 11: dosya ekleri ve bireysel aramalar
--
-- Dosyalar: "ekler" kovasına artık her tür dosya yüklenebilir (en fazla 25 MB). Görseller yine
--   uygulamada küçültülür; diğer dosyalar olduğu gibi yüklenir ve sohbette dosya kartı olarak görünür.
-- Aramalar: özel mesajdaki iki kişi birbirini arayabilir. Çaldırma "calls" tablosundan geçer
--   (iki taraf da değişiklik akışından haberdar olur); ses yine doğrudan (P2P) akar.
--   Biten her arama sohbete bir "arama" mesajı olarak düşer (cevapsız, reddedildi, süre).

-- ---------------------------------------------------------------------------
-- Dosya ekleri
-- ---------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 25 * 1024 * 1024,
       allowed_mime_types = null
 where id = 'ekler';

-- Mesaj türü: normal yazı ya da sistemin eklediği arama kaydı. Kullanıcılar bu sütunu yazamaz.
alter table public.messages
  add column kind text not null default 'text' constraint messages_kind check (kind in ('text', 'call'));

create or replace function private.messages_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;

    if new.reply_to is not null and not exists (
      select 1 from public.messages where id = new.reply_to and channel_id = new.channel_id
    ) then
      new.reply_to := null;
    end if;

    if jsonb_typeof(new.attachments) <> 'array' or jsonb_array_length(new.attachments) > 4 then
      raise exception 'turkcord:invalid_attachments';
    end if;

    -- Ekler sadece bu kanala ve yazana ait klasörden olabilir: {kanal}/{kullanıcı}/dosya
    if exists (
      select 1
        from jsonb_array_elements(new.attachments) a
       where jsonb_typeof(a) <> 'object'
          or coalesce(a ->> 'path', '') not like new.channel_id::text || '/' || new.author_id::text || '/%'
          or coalesce(a ->> 'path', '') like '%..%'
          or (a ? 'name' and (jsonb_typeof(a -> 'name') <> 'string' or char_length(a ->> 'name') > 200))
          or (a ? 'type' and (jsonb_typeof(a -> 'type') <> 'string' or char_length(a ->> 'type') > 120))
    ) then
      raise exception 'turkcord:invalid_attachments';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.content is distinct from old.content then
      -- Arama kayıtları düzenlenemez.
      if old.kind <> 'text' then
        raise exception 'turkcord:forbidden';
      end if;
      new.edited_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.messages_before_write() from public;

-- Yönetici paneli: depolama alanı kullanımı (ücretsiz planda toplam 1 GB).
create or replace function public.admin_storage_usage()
returns table (bucket text, files bigint, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'turkcord:forbidden';
  end if;
  return query
    select o.bucket_id::text,
           count(*)::bigint,
           coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0)::bigint
      from storage.objects o
     where o.bucket_id in ('ekler', 'gorseller')
     group by o.bucket_id;
end;
$$;

-- Temizlik: eski ve büyük ekler. Sadece sunucu tarafı (Edge Function) çağırır; dosyaları Storage API ile siler.
create or replace function public.stale_attachments(p_days int, p_min_bytes bigint)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name::text
    from storage.objects o
   where o.bucket_id = 'ekler'
     and o.created_at < now() - make_interval(days => greatest(p_days, 7))
     and coalesce(nullif(o.metadata ->> 'size', '')::bigint, 0) >= greatest(p_min_bytes, 0)
   order by o.created_at
   limit 500;
$$;

revoke all on function public.admin_storage_usage() from public, anon;
revoke all on function public.stale_attachments(int, bigint) from public, anon, authenticated;
grant execute on function public.admin_storage_usage() to authenticated;
grant execute on function public.stale_attachments(int, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Bireysel aramalar
-- ---------------------------------------------------------------------------

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  caller_id uuid not null references public.profiles (id) on delete cascade,
  callee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'ringing'
    constraint calls_status check (status in ('ringing', 'accepted', 'declined', 'missed', 'ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  constraint calls_not_self check (caller_id <> callee_id)
);

create index calls_channel_idx on public.calls (channel_id, created_at desc);
create index calls_caller_idx on public.calls (caller_id, created_at desc);
create index calls_callee_idx on public.calls (callee_id);

alter table public.calls enable row level security;

create policy "turkcord: taraflar aramayı görür"
  on public.calls for select
  to authenticated
  using ((select auth.uid()) in (caller_id, callee_id));

grant select on public.calls to authenticated;

alter publication supabase_realtime add table public.calls;

-- Aramayı kapatır ve sohbete kaydını düşer. Zaten kapanmışsa bir şey yapmaz.
create or replace function private.finish_call(p_call uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_call public.calls;
begin
  update public.calls
     set status = p_status, ended_at = now()
   where id = p_call and status in ('ringing', 'accepted')
  returning * into v_call;

  if v_call.id is null then
    return;
  end if;

  insert into public.messages (channel_id, author_id, kind, content)
  values (
    v_call.channel_id,
    v_call.caller_id,
    'call',
    case
      when p_status = 'ended' and v_call.answered_at is not null
        then 'ended:' || greatest(0, floor(extract(epoch from (v_call.ended_at - v_call.answered_at))))::int::text
      else p_status
    end
  );
end;
$$;

create or replace function public.start_call(p_channel uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_other uuid;
  v_old record;
  v_call uuid;
begin
  if v_me is null
     or not exists (select 1 from public.channels where id = p_channel and kind = 'dm')
     or not private.can_post(p_channel) then
    raise exception 'turkcord:forbidden';
  end if;

  select user_id into v_other from public.dm_members where channel_id = p_channel and user_id <> v_me limit 1;
  if v_other is null then
    raise exception 'turkcord:invalid_input';
  end if;

  if (select count(*) from public.calls where caller_id = v_me and created_at > now() - interval '1 minute') >= 6 then
    raise exception 'turkcord:rate_limited';
  end if;

  -- Yarım kalmış eski aramaları kapat (ör. uygulama çöktüyse).
  for v_old in
    select id, status from public.calls
     where channel_id = p_channel
       and (status = 'accepted' or (status = 'ringing' and created_at < now() - interval '60 seconds'))
  loop
    perform private.finish_call(v_old.id, case when v_old.status = 'accepted' then 'ended' else 'missed' end);
  end loop;

  if exists (select 1 from public.calls where channel_id = p_channel and status = 'ringing') then
    raise exception 'turkcord:busy';
  end if;

  insert into public.calls (channel_id, caller_id, callee_id)
  values (p_channel, v_me, v_other)
  returning id into v_call;
  return v_call;
end;
$$;

create or replace function public.answer_call(p_call uuid, p_accept boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.calls where id = p_call and callee_id = (select auth.uid()) and status = 'ringing'
  ) then
    raise exception 'turkcord:not_found';
  end if;

  if p_accept then
    update public.calls set status = 'accepted', answered_at = now() where id = p_call and status = 'ringing';
  else
    perform private.finish_call(p_call, 'declined');
  end if;
end;
$$;

-- Kapat: çalarken arayan vazgeçerse "cevapsız", aranan kapatırsa "reddedildi"; görüşme sırasında "bitti".
create or replace function public.end_call(p_call uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_call public.calls;
begin
  select * into v_call from public.calls
   where id = p_call and v_me in (caller_id, callee_id) and status in ('ringing', 'accepted');
  if v_call.id is null then
    return;
  end if;

  perform private.finish_call(
    p_call,
    case
      when v_call.status = 'accepted' then 'ended'
      when v_call.caller_id = v_me then 'missed'
      else 'declined'
    end
  );
end;
$$;

revoke all on function private.finish_call(uuid, text) from public;
revoke all on function public.start_call(uuid) from public, anon;
revoke all on function public.answer_call(uuid, boolean) from public, anon;
revoke all on function public.end_call(uuid) from public, anon;
grant execute on function public.start_call(uuid) to authenticated;
grant execute on function public.answer_call(uuid, boolean) to authenticated;
grant execute on function public.end_call(uuid) to authenticated;

-- Okunmamış sayısı: arama kayıtlarından sadece cevapsız aramalar sayılır (konuşulmuş bir arama "okunmamış" değildir).
create or replace function public.unread_counts()
returns table (channel_id uuid, server_id uuid, unread int, mentions int)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id as uid, '@' || p.username as tag
      from public.profiles p
     where p.id = (select auth.uid())
  ),
  my_channels as (
    select c.id, c.server_id, sm.joined_at as since
      from public.channels c
      join public.server_members sm on sm.server_id = c.server_id
     where sm.user_id = (select uid from me) and c.kind = 'text'
    union all
    select c.id, null::uuid, '-infinity'::timestamptz
      from public.channels c
      join public.dm_members d on d.channel_id = c.id
     where d.user_id = (select uid from me)
  )
  select mc.id,
         mc.server_id,
         least(count(m.id), 99)::int,
         least(count(m.id) filter (
           where m.kind = 'text' and position(lower((select tag from me)) in lower(m.content)) > 0), 99)::int
    from my_channels mc
    left join public.channel_reads r on r.channel_id = mc.id and r.user_id = (select uid from me)
    join public.messages m
      on m.channel_id = mc.id
     and m.created_at > greatest(coalesce(r.last_read_at, '-infinity'::timestamptz), mc.since)
     and m.author_id is distinct from (select uid from me)
     and (m.kind = 'text' or m.content = 'missed')
   group by mc.id, mc.server_id;
$$;

revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;

-- Arama odası: "ara:{kanal}" konusunda kimin aramada olduğu (presence). Sinyaller mevcut "ses:{kanal}"
-- kurallarıyla gider. "chan:{kanal}" bilerek kullanılmaz: özel mesajda o konu "yazıyor…" için açıktır.
create policy "turkcord: arama odasını dinleme"
  on realtime.messages for select
  to authenticated
  using (
    (select realtime.topic()) like 'ara:%'
    and realtime.messages.extension = 'presence'
    and private.can_access_channel(private.try_uuid(substr((select realtime.topic()), 5)))
  );

create policy "turkcord: arama odasına katılma"
  on realtime.messages for insert
  to authenticated
  with check (
    (select realtime.topic()) like 'ara:%'
    and realtime.messages.extension = 'presence'
    and private.can_access_channel(private.try_uuid(substr((select realtime.topic()), 5)))
  );
