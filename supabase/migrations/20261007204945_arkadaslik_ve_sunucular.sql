-- Turkcord 02: arkadaşlık ve sunucular
-- Arkadaşlık, engelleme, sunucular, üyeler, kanallar ve DM'ler.
--
-- Yazma işlemlerinin çoğu kuralları tek yerde toplamak için fonksiyonlardan (RPC) geçer.
-- Okumalar satır seviyesinde güvenlik (RLS) ile korunur.

-- ---------------------------------------------------------------------------
-- Arkadaşlık ve engelleme
-- ---------------------------------------------------------------------------

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' constraint friendships_status check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id)
);

create unique index friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;

create policy "Taraflar arkadaşlık kaydını görebilir"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

grant select on public.friendships to authenticated;

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

create policy "Kullanıcı kendi engellediklerini görebilir"
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

grant select on public.blocks to authenticated;

create or replace function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

-- ---------------------------------------------------------------------------
-- Sunucular, üyeler, kanallar, DM'ler
-- ---------------------------------------------------------------------------

create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint servers_name_length check (char_length(btrim(name)) between 1 and 50),
  icon_path text constraint servers_icon_path_owner check (icon_path is null or icon_path like 's/' || id::text || '/%'),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index servers_owner_idx on public.servers (owner_id);

create table public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' constraint server_members_role check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create index server_members_user_idx on public.server_members (user_id);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references public.servers (id) on delete cascade,
  kind text not null constraint channels_kind check (kind in ('text', 'voice', 'dm')),
  name text,
  topic text constraint channels_topic_length check (char_length(topic) <= 200),
  position int not null default 0,
  dm_key text unique,
  created_at timestamptz not null default now(),
  constraint channels_kind_scope check ((kind = 'dm') = (server_id is null)),
  constraint channels_name_required check (kind = 'dm' or (name is not null and char_length(btrim(name)) between 1 and 32)),
  constraint channels_dm_key_required check ((kind = 'dm') = (dm_key is not null))
);

create index channels_server_idx on public.channels (server_id);

create table public.dm_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index dm_members_user_idx on public.dm_members (user_id);

create table public.server_invites (
  code text primary key,
  server_id uuid not null references public.servers (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  max_uses int constraint server_invites_max_uses check (max_uses is null or max_uses between 1 and 1000),
  uses int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index server_invites_server_idx on public.server_invites (server_id);

alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.dm_members enable row level security;
alter table public.server_invites enable row level security;

-- Erişim yardımcıları (security definer: tabloları RLS'e takılmadan okur, sonsuz döngüyü önler).

create or replace function private.member_role(p_server uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.server_members
   where server_id = p_server and user_id = (select auth.uid());
$$;

create or replace function private.is_member(p_server uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.server_members
     where server_id = p_server and user_id = (select auth.uid())
  );
$$;

create or replace function private.can_access_channel(p_channel uuid)
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
         (c.server_id is not null and exists (
            select 1 from public.server_members m
             where m.server_id = c.server_id and m.user_id = (select auth.uid())))
         or
         (c.server_id is null and exists (
            select 1 from public.dm_members d
             where d.channel_id = c.id and d.user_id = (select auth.uid())))
       )
  );
$$;

-- Yazı kanalına ya da DM'e mesaj atılabilir mi? DM'de taraflardan biri diğerini engellediyse atılamaz.
create or replace function private.can_post(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_channel(p_channel)
     and exists (select 1 from public.channels c where c.id = p_channel and c.kind in ('text', 'dm'))
     and not exists (
       select 1
         from public.dm_members d
        where d.channel_id = p_channel
          and d.user_id <> (select auth.uid())
          and private.is_blocked_between(d.user_id, (select auth.uid()))
     );
$$;

create or replace function private.can_moderate_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
      join public.server_members m on m.server_id = c.server_id
     where c.id = p_channel
       and m.user_id = (select auth.uid())
       and m.role in ('owner', 'admin')
  );
$$;

create policy "Üyeler sunucuyu görebilir"
  on public.servers for select
  to authenticated
  using (private.is_member(id));

create policy "Sahip ve yöneticiler sunucuyu düzenleyebilir"
  on public.servers for update
  to authenticated
  using (private.member_role(id) in ('owner', 'admin'))
  with check (private.member_role(id) in ('owner', 'admin'));

create policy "Sahip sunucuyu silebilir"
  on public.servers for delete
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Üyeler diğer üyeleri görebilir"
  on public.server_members for select
  to authenticated
  using (private.is_member(server_id));

create policy "Erişimi olan kanalı görebilir"
  on public.channels for select
  to authenticated
  using (private.can_access_channel(id));

create policy "DM katılımcıları birbirini görebilir"
  on public.dm_members for select
  to authenticated
  using (private.can_access_channel(channel_id));

create policy "Üyeler sunucu davetlerini görebilir"
  on public.server_invites for select
  to authenticated
  using (private.is_member(server_id));

grant select on public.servers to authenticated;
grant update (name, icon_path) on public.servers to authenticated;
grant delete on public.servers to authenticated;
grant select on public.server_members to authenticated;
grant select on public.channels to authenticated;
grant select on public.dm_members to authenticated;
grant select on public.server_invites to authenticated;

revoke all on function private.is_blocked_between(uuid, uuid) from public;
revoke all on function private.member_role(uuid) from public;
revoke all on function private.is_member(uuid) from public;
revoke all on function private.can_access_channel(uuid) from public;
revoke all on function private.can_post(uuid) from public;
revoke all on function private.can_moderate_channel(uuid) from public;
grant execute on function private.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function private.member_role(uuid) to authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.can_access_channel(uuid) to authenticated;
grant execute on function private.can_post(uuid) to authenticated;
grant execute on function private.can_moderate_channel(uuid) to authenticated;
