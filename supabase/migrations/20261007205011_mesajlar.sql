-- Turkcord 03: mesajlar
-- Mesajlar, tepkiler ve okunmamış takibi.

-- ---------------------------------------------------------------------------
-- Mesajlar ve tepkiler
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  reply_to uuid references public.messages (id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_content_length check (char_length(content) <= 4000),
  constraint messages_not_empty check (char_length(btrim(content)) > 0 or jsonb_array_length(attachments) > 0)
);

create index messages_channel_created_idx on public.messages (channel_id, created_at desc);
create index messages_author_idx on public.messages (author_id);
create index messages_reply_to_idx on public.messages (reply_to);

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji text not null constraint message_reactions_emoji_length check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  constraint message_reactions_unique unique (message_id, user_id, emoji)
);

create index message_reactions_user_idx on public.message_reactions (user_id);

alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

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
    ) then
      raise exception 'turkcord:invalid_attachments';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.content is distinct from old.content then
      new.edited_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_before_write
  before insert or update on public.messages
  for each row execute function private.messages_before_write();

create policy "Kanala erişimi olan mesajları okuyabilir"
  on public.messages for select
  to authenticated
  using (private.can_access_channel(channel_id));

create policy "Yazabildiği kanala kendi adına mesaj atabilir"
  on public.messages for insert
  to authenticated
  with check (author_id = (select auth.uid()) and private.can_post(channel_id));

create policy "Kendi mesajını düzenleyebilir"
  on public.messages for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "Kendi mesajını ya da yönettiği kanaldaki mesajı silebilir"
  on public.messages for delete
  to authenticated
  using (author_id = (select auth.uid()) or private.can_moderate_channel(channel_id));

grant select, delete on public.messages to authenticated;
grant insert (channel_id, content, attachments, reply_to) on public.messages to authenticated;
grant update (content) on public.messages to authenticated;

create policy "Kanala erişimi olan tepkileri görebilir"
  on public.message_reactions for select
  to authenticated
  using (exists (
    select 1 from public.messages m
     where m.id = message_id and private.can_access_channel(m.channel_id)
  ));

create policy "Erişebildiği mesaja kendi adına tepki verebilir"
  on public.message_reactions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
       where m.id = message_id and private.can_post(m.channel_id)
    )
  );

create policy "Kendi tepkisini kaldırabilir"
  on public.message_reactions for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.message_reactions to authenticated;
grant insert (message_id, emoji) on public.message_reactions to authenticated;

-- ---------------------------------------------------------------------------
-- Okunmamış takibi
-- ---------------------------------------------------------------------------

create table public.channel_reads (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create index channel_reads_channel_idx on public.channel_reads (channel_id);

alter table public.channel_reads enable row level security;

create policy "Kullanıcı kendi okuma kayıtlarını görebilir"
  on public.channel_reads for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.channel_reads to authenticated;

create or replace function public.mark_channel_read(p_channel uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_access_channel(p_channel) then
    raise exception 'turkcord:forbidden';
  end if;
  insert into public.channel_reads (user_id, channel_id, last_read_at)
  values ((select auth.uid()), p_channel, now())
  on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- Her kanal için okunmamış mesaj sayısı (en fazla 99) ve kullanıcının etiketlendiği mesaj sayısı.
-- Sunucu kanallarında katılmadan önceki mesajlar okunmamış sayılmaz.
create or replace function public.unread_counts()
returns table (channel_id uuid, unread int, mentions int)
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
    select c.id, sm.joined_at as since
      from public.channels c
      join public.server_members sm on sm.server_id = c.server_id
     where sm.user_id = (select uid from me) and c.kind = 'text'
    union all
    select c.id, '-infinity'::timestamptz
      from public.channels c
      join public.dm_members d on d.channel_id = c.id
     where d.user_id = (select uid from me)
  )
  select mc.id,
         least(count(m.id), 99)::int,
         least(count(m.id) filter (where position(lower((select tag from me)) in lower(m.content)) > 0), 99)::int
    from my_channels mc
    left join public.channel_reads r on r.channel_id = mc.id and r.user_id = (select uid from me)
    join public.messages m
      on m.channel_id = mc.id
     and m.created_at > greatest(coalesce(r.last_read_at, '-infinity'::timestamptz), mc.since)
     and m.author_id is distinct from (select uid from me)
   group by mc.id;
$$;

revoke all on function private.messages_before_write() from public;
