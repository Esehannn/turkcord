-- Turkcord 05: sunucu fonksiyonları
-- Sunucu, kanal, üye ve davet işlemleri.

-- ---------------------------------------------------------------------------
-- Sunucu fonksiyonları
-- ---------------------------------------------------------------------------

create or replace function public.create_server(p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_server uuid;
begin
  if v_me is null then
    raise exception 'turkcord:forbidden';
  end if;
  if (select count(*) from public.servers where owner_id = v_me) >= 20 then
    raise exception 'turkcord:limit_reached';
  end if;

  insert into public.servers (name, owner_id) values (btrim(p_name), v_me) returning id into v_server;
  insert into public.server_members (server_id, user_id, role) values (v_server, v_me, 'owner');
  insert into public.channels (server_id, kind, name, position) values
    (v_server, 'text', 'genel', 0),
    (v_server, 'text', 'sohbet', 1),
    (v_server, 'voice', 'Kahvehane', 0);
  return v_server;
end;
$$;

create or replace function public.leave_server(p_server uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.member_role(p_server) = 'owner' then
    raise exception 'turkcord:owner_cannot_leave';
  end if;
  delete from public.server_members where server_id = p_server and user_id = (select auth.uid());
end;
$$;

create or replace function public.kick_member(p_server uuid, p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_my_role text := private.member_role(p_server);
  v_their_role text;
begin
  select role into v_their_role from public.server_members where server_id = p_server and user_id = p_user;
  if v_their_role is null then
    raise exception 'turkcord:not_found';
  end if;
  if p_user = (select auth.uid())
     or v_their_role = 'owner'
     or v_my_role is null
     or v_my_role = 'member'
     or (v_my_role = 'admin' and v_their_role <> 'member') then
    raise exception 'turkcord:forbidden';
  end if;
  delete from public.server_members where server_id = p_server and user_id = p_user;
end;
$$;

create or replace function public.set_member_role(p_server uuid, p_user uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.member_role(p_server) is distinct from 'owner' or p_role not in ('admin', 'member') then
    raise exception 'turkcord:forbidden';
  end if;
  update public.server_members
     set role = p_role
   where server_id = p_server and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'turkcord:not_found';
  end if;
end;
$$;

create or replace function public.create_channel(p_server uuid, p_name text, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel uuid;
begin
  if coalesce(private.member_role(p_server), '') not in ('owner', 'admin') then
    raise exception 'turkcord:forbidden';
  end if;
  if p_kind not in ('text', 'voice') then
    raise exception 'turkcord:invalid_input';
  end if;
  if (select count(*) from public.channels where server_id = p_server) >= 50 then
    raise exception 'turkcord:limit_reached';
  end if;
  insert into public.channels (server_id, kind, name, position)
  values (
    p_server, p_kind, btrim(p_name),
    coalesce((select max(position) + 1 from public.channels where server_id = p_server and kind = p_kind), 0)
  )
  returning id into v_channel;
  return v_channel;
end;
$$;

create or replace function public.update_channel(p_channel uuid, p_name text, p_topic text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_moderate_channel(p_channel) then
    raise exception 'turkcord:forbidden';
  end if;
  update public.channels
     set name = btrim(p_name),
         topic = nullif(btrim(coalesce(p_topic, '')), '')
   where id = p_channel;
end;
$$;

create or replace function public.delete_channel(p_channel uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_moderate_channel(p_channel) then
    raise exception 'turkcord:forbidden';
  end if;
  delete from public.channels where id = p_channel;
end;
$$;

-- Davet kodu: süre saat cinsinden (null = süresiz), kullanım sınırı (null = sınırsız).
create or replace function public.create_server_invite(p_server uuid, p_max_uses int default null, p_expires_hours int default 168)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_member(p_server) then
    raise exception 'turkcord:forbidden';
  end if;
  if (p_max_uses is not null and p_max_uses not between 1 and 1000)
     or (p_expires_hours is not null and p_expires_hours not between 1 and 8760) then
    raise exception 'turkcord:invalid_input';
  end if;
  loop
    v_code := private.random_code(8);
    begin
      insert into public.server_invites (code, server_id, created_by, max_uses, expires_at)
      values (
        v_code, p_server, (select auth.uid()), p_max_uses,
        case when p_expires_hours is null then null else now() + make_interval(hours => p_expires_hours) end
      );
      exit;
    exception when unique_violation then
    end;
  end loop;
  return v_code;
end;
$$;

create or replace function public.revoke_server_invite(p_code text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.server_invites i
   where i.code = private.normalize_code(p_code)
     and (i.created_by = (select auth.uid()) or private.member_role(i.server_id) in ('owner', 'admin'));
end;
$$;

-- Katılmadan önce davetin hangi sunucuya ait olduğunu gösterir.
create or replace function public.preview_server_invite(p_code text)
returns table (server_id uuid, name text, icon_path text, member_count int, already_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.icon_path,
         (select count(*)::int from public.server_members m where m.server_id = s.id),
         private.is_member(s.id)
    from public.server_invites i
    join public.servers s on s.id = i.server_id
   where i.code = private.normalize_code(p_code)
     and (i.expires_at is null or i.expires_at > now())
     and (i.max_uses is null or i.uses < i.max_uses)
     and (select auth.uid()) is not null;
$$;

create or replace function public.join_server(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_invite public.server_invites%rowtype;
begin
  if v_me is null then
    raise exception 'turkcord:forbidden';
  end if;
  select * into v_invite
    from public.server_invites
   where code = private.normalize_code(p_code)
   for update;
  if not found
     or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or (v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses) then
    raise exception 'turkcord:invalid_invite';
  end if;
  if private.is_member(v_invite.server_id) then
    return v_invite.server_id;
  end if;
  insert into public.server_members (server_id, user_id, role) values (v_invite.server_id, v_me, 'member');
  update public.server_invites set uses = uses + 1 where code = v_invite.code;
  return v_invite.server_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Yetkiler: varsayılan erişim yok, sadece giriş yapmış kullanıcılar çağırabilir.
-- ---------------------------------------------------------------------------

revoke all on function public.create_server(text) from public, anon;
revoke all on function public.leave_server(uuid) from public, anon;
revoke all on function public.kick_member(uuid, uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.create_channel(uuid, text, text) from public, anon;
revoke all on function public.update_channel(uuid, text, text) from public, anon;
revoke all on function public.delete_channel(uuid) from public, anon;
revoke all on function public.create_server_invite(uuid, int, int) from public, anon;
revoke all on function public.revoke_server_invite(text) from public, anon;
revoke all on function public.preview_server_invite(text) from public, anon;
revoke all on function public.join_server(text) from public, anon;
grant execute on function public.create_server(text) to authenticated;
grant execute on function public.leave_server(uuid) to authenticated;
grant execute on function public.kick_member(uuid, uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.create_channel(uuid, text, text) to authenticated;
grant execute on function public.update_channel(uuid, text, text) to authenticated;
grant execute on function public.delete_channel(uuid) to authenticated;
grant execute on function public.create_server_invite(uuid, int, int) to authenticated;
grant execute on function public.revoke_server_invite(text) to authenticated;
grant execute on function public.preview_server_invite(text) to authenticated;
grant execute on function public.join_server(text) to authenticated;
