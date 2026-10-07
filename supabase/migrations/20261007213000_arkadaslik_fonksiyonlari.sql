-- Turkcord 04: arkadaşlık ve DM fonksiyonları
-- Yazma işlemleri kuralları tek yerde toplamak için fonksiyonlardan geçer.

-- ---------------------------------------------------------------------------
-- Arkadaşlık fonksiyonları
-- ---------------------------------------------------------------------------

-- Dönüş: 'sent' (istek gönderildi) ya da 'accepted' (karşı taraf zaten istek atmıştı, arkadaş oldunuz).
create or replace function public.send_friend_request(p_username text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_target uuid;
  v_existing public.friendships%rowtype;
begin
  select id into v_target from public.profiles where username = lower(btrim(p_username));
  if v_target is null then
    raise exception 'turkcord:user_not_found';
  end if;
  if v_target = v_me then
    raise exception 'turkcord:self';
  end if;
  if private.is_blocked_between(v_me, v_target) then
    raise exception 'turkcord:blocked';
  end if;

  select * into v_existing
    from public.friendships
   where least(requester_id, addressee_id) = least(v_me, v_target)
     and greatest(requester_id, addressee_id) = greatest(v_me, v_target)
   for update;

  if found then
    if v_existing.status = 'accepted' then
      raise exception 'turkcord:already_friends';
    end if;
    if v_existing.requester_id = v_me then
      raise exception 'turkcord:already_sent';
    end if;
    update public.friendships
       set status = 'accepted', responded_at = now()
     where id = v_existing.id;
    return 'accepted';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_me, v_target);
  return 'sent';
end;
$$;

create or replace function public.respond_friend_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if p_accept then
    update public.friendships
       set status = 'accepted', responded_at = now()
     where id = p_request and addressee_id = v_me and status = 'pending';
  else
    delete from public.friendships
     where id = p_request and addressee_id = v_me and status = 'pending';
  end if;
  if not found then
    raise exception 'turkcord:not_found';
  end if;
end;
$$;

-- Arkadaşlıktan çıkarır, gönderilen isteği geri çeker ya da gelen isteği reddeder.
create or replace function public.remove_friend(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  delete from public.friendships
   where least(requester_id, addressee_id) = least(v_me, p_user)
     and greatest(requester_id, addressee_id) = greatest(v_me, p_user);
end;
$$;

create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if p_user = v_me or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'turkcord:invalid_input';
  end if;
  delete from public.friendships
   where least(requester_id, addressee_id) = least(v_me, p_user)
     and greatest(requester_id, addressee_id) = greatest(v_me, p_user);
  insert into public.blocks (blocker_id, blocked_id) values (v_me, p_user)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_user(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.blocks where blocker_id = (select auth.uid()) and blocked_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- DM fonksiyonları
-- ---------------------------------------------------------------------------

create or replace function public.get_or_create_dm(p_user uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_key text;
  v_channel uuid;
begin
  if v_me is null or p_user = v_me or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'turkcord:invalid_input';
  end if;

  v_key := least(v_me, p_user)::text || ':' || greatest(v_me, p_user)::text;

  select id into v_channel from public.channels where dm_key = v_key;
  if v_channel is not null then
    return v_channel;
  end if;

  if private.is_blocked_between(v_me, p_user) then
    raise exception 'turkcord:blocked';
  end if;

  insert into public.channels (kind, dm_key) values ('dm', v_key)
  on conflict (dm_key) do nothing
  returning id into v_channel;

  if v_channel is null then
    -- Aynı anda diğer taraf oluşturdu.
    select id into v_channel from public.channels where dm_key = v_key;
  end if;

  insert into public.dm_members (channel_id, user_id)
  values (v_channel, v_me), (v_channel, p_user)
  on conflict do nothing;

  return v_channel;
end;
$$;

create or replace function public.list_dms()
returns table (
  channel_id uuid,
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  custom_status text,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, p.id, p.username, p.display_name, p.avatar_path, p.custom_status,
         (select max(m.created_at) from public.messages m where m.channel_id = c.id)
    from public.dm_members me
    join public.channels c on c.id = me.channel_id and c.kind = 'dm'
    join public.dm_members other on other.channel_id = c.id and other.user_id <> me.user_id
    join public.profiles p on p.id = other.user_id
   where me.user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Yetkiler: varsayılan erişim yok, sadece giriş yapmış kullanıcılar çağırabilir.
-- ---------------------------------------------------------------------------

revoke all on function public.mark_channel_read(uuid) from public, anon;
revoke all on function public.unread_counts() from public, anon;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.get_or_create_dm(uuid) from public, anon;
revoke all on function public.list_dms() from public, anon;
grant execute on function public.mark_channel_read(uuid) to authenticated;
grant execute on function public.unread_counts() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.get_or_create_dm(uuid) to authenticated;
grant execute on function public.list_dms() to authenticated;
