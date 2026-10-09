-- Turkcord 12: sabitlenmiş mesajlar, anketler, mesaj iletme, "görüldü" ve sesli kanala giriş bildirimi
--
-- Sabitleme: mesajda pinned_at / pinned_by. Özel mesajda iki taraf da, sunucuda sahip ve yöneticiler sabitler.
-- Anket: türü "poll" olan mesaj; soru içerikte, seçenekler "poll" sütununda, oylar poll_votes tablosunda.
-- İletme: iletilen mesaj normal bir mesajdır, sadece "forwarded" işaretini taşır.
-- Görüldü: özel mesajda karşı tarafın okuma kaydı (channel_reads) görülebilir.
-- Giriş bildirimi: ses kanalına giren kişi voice_joins'e bir satır yazar; sunucudaki herkes bunu
--   mevcut değişiklik akışından alır (her ses kanalı için ayrı bağlantı açmaya gerek kalmaz).

-- ---------------------------------------------------------------------------
-- Mesajlar: sabitleme, iletme ve anket sütunları
-- ---------------------------------------------------------------------------

alter table public.messages
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles (id) on delete set null,
  add column forwarded boolean not null default false,
  add column poll jsonb;

alter table public.messages drop constraint messages_kind;
alter table public.messages
  add constraint messages_kind check (kind in ('text', 'call', 'poll')),
  add constraint messages_poll_shape check ((kind = 'poll') = (poll is not null));

create index messages_pinned_idx on public.messages (channel_id, pinned_at desc) where pinned_at is not null;
create index messages_pinned_by_idx on public.messages (pinned_by) where pinned_by is not null;

-- Kullanıcı sadece "iletildi" işaretini kendisi koyabilir; sabitleme ve anket RPC'lerden geçer.
grant insert (forwarded) on public.messages to authenticated;

create or replace function public.set_message_pinned(p_message uuid, p_pinned boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel uuid;
  v_kind text;
begin
  select m.channel_id, m.kind into v_channel, v_kind from public.messages m where m.id = p_message;
  if v_channel is null or not private.can_access_channel(v_channel) then
    raise exception 'turkcord:not_found';
  end if;

  if v_kind = 'call'
     or not (
       exists (select 1 from public.channels c where c.id = v_channel and c.kind = 'dm')
       or private.can_moderate_channel(v_channel)
     ) then
    raise exception 'turkcord:forbidden';
  end if;

  if p_pinned then
    if (select count(*) from public.messages where channel_id = v_channel and pinned_at is not null) >= 50 then
      raise exception 'turkcord:limit_reached';
    end if;
    update public.messages
       set pinned_at = now(), pinned_by = (select auth.uid())
     where id = p_message and pinned_at is null;
  else
    update public.messages set pinned_at = null, pinned_by = null where id = p_message;
  end if;
end;
$$;

revoke all on function public.set_message_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_message_pinned(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Anketler
-- ---------------------------------------------------------------------------

create table public.poll_votes (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  option smallint not null constraint poll_votes_option_range check (option between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index poll_votes_user_idx on public.poll_votes (user_id);

alter table public.poll_votes enable row level security;

create policy "Kanala erişimi olan oyları görebilir"
  on public.poll_votes for select
  to authenticated
  using (exists (
    select 1 from public.messages m
     where m.id = message_id and private.can_access_channel(m.channel_id)
  ));

grant select on public.poll_votes to authenticated;

alter publication supabase_realtime add table public.poll_votes;

create or replace function public.create_poll(p_channel uuid, p_question text, p_options text[])
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_question text := btrim(coalesce(p_question, ''));
  v_options text[];
  v_id uuid;
begin
  if v_me is null or not private.can_post(p_channel) then
    raise exception 'turkcord:forbidden';
  end if;

  select coalesce(array_agg(btrim(o) order by ord), '{}')
    into v_options
    from unnest(coalesce(p_options, '{}')) with ordinality as t (o, ord)
   where btrim(coalesce(o, '')) <> '';

  if char_length(v_question) not between 1 and 300
     or coalesce(array_length(v_options, 1), 0) not between 2 and 6
     or exists (select 1 from unnest(v_options) o where char_length(o) > 80) then
    raise exception 'turkcord:invalid_input';
  end if;

  insert into public.messages (channel_id, author_id, kind, content, poll)
  values (p_channel, v_me, 'poll', v_question, jsonb_build_object('options', to_jsonb(v_options)))
  returning id into v_id;
  return v_id;
end;
$$;

-- Oy verir ya da değiştirir; p_option null ise oyu geri alır.
create or replace function public.vote_poll(p_message uuid, p_option int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_channel uuid;
  v_count int;
begin
  select m.channel_id, jsonb_array_length(m.poll -> 'options')
    into v_channel, v_count
    from public.messages m
   where m.id = p_message and m.kind = 'poll';

  if v_channel is null or v_me is null or not private.can_post(v_channel) then
    raise exception 'turkcord:forbidden';
  end if;

  if p_option is null then
    delete from public.poll_votes where message_id = p_message and user_id = v_me;
    return;
  end if;

  if p_option < 0 or p_option >= v_count then
    raise exception 'turkcord:invalid_input';
  end if;

  insert into public.poll_votes (message_id, user_id, option)
  values (p_message, v_me, p_option)
  on conflict (message_id, user_id) do update set option = excluded.option, created_at = now();
end;
$$;

revoke all on function public.create_poll(uuid, text, text[]) from public, anon;
revoke all on function public.vote_poll(uuid, int) from public, anon;
grant execute on function public.create_poll(uuid, text, text[]) to authenticated;
grant execute on function public.vote_poll(uuid, int) to authenticated;

-- Okunmamış sayısı: anketler de normal mesaj gibi sayılır.
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
     and (m.kind in ('text', 'poll') or m.content = 'missed')
   group by mc.id, mc.server_id;
$$;

revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- Görüldü: özel mesajda karşı tarafın okuma kaydı
-- ---------------------------------------------------------------------------

create or replace function private.is_dm_member(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dm_members d
     where d.channel_id = p_channel and d.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_dm_member(uuid) from public;
grant execute on function private.is_dm_member(uuid) to authenticated;

create policy "Özel mesajda karşı tarafın okuma kaydı görülebilir"
  on public.channel_reads for select
  to authenticated
  using (private.is_dm_member(channel_id));

alter publication supabase_realtime add table public.channel_reads;

-- ---------------------------------------------------------------------------
-- Sesli kanala giriş bildirimi
-- ---------------------------------------------------------------------------

create table public.voice_joins (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index voice_joins_user_idx on public.voice_joins (user_id);

alter table public.voice_joins enable row level security;

create policy "Kanala erişimi olan girişleri görebilir"
  on public.voice_joins for select
  to authenticated
  using (private.can_access_channel(channel_id));

grant select on public.voice_joins to authenticated;

alter publication supabase_realtime add table public.voice_joins;

-- Ses kanalına girince çağrılır. Kısa süre içinde tekrar girişler (bağlantı kopup gelmesi) yeniden bildirilmez.
create or replace function public.announce_voice_join(p_channel uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_access_channel(p_channel)
     or not exists (select 1 from public.channels c where c.id = p_channel and c.kind = 'voice') then
    raise exception 'turkcord:forbidden';
  end if;

  insert into public.voice_joins (channel_id, user_id)
  values (p_channel, (select auth.uid()))
  on conflict (channel_id, user_id) do update set joined_at = now()
    where public.voice_joins.joined_at < now() - interval '2 minutes';
end;
$$;

revoke all on function public.announce_voice_join(uuid) from public, anon;
grant execute on function public.announce_voice_join(uuid) to authenticated;
