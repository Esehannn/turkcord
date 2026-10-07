-- Turkcord 10: sunucu rolleri
-- Sunucu sahibi ve yöneticileri adlı, renkli roller (ör. "Çaycı", "Oyuncu") oluşturup üyelere verebilir.
-- Roller görünüş içindir: üye listesinde gruplar ve isim rengi. Yetkiler yine sahip/yönetici/üye ile belirlenir.

create table public.server_roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null constraint server_roles_name check (char_length(btrim(name)) between 1 and 30),
  color text not null default '#e30a17' constraint server_roles_color check (color ~ '^#[0-9a-f]{6}$'),
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint server_roles_server_id_id unique (server_id, id)
);

create index server_roles_server_idx on public.server_roles (server_id, position);

-- Üyenin rolü aynı sunucuya ait olmak zorunda; rol silinince üyeden de kalkar.
alter table public.server_members add column role_id uuid;
alter table public.server_members
  add constraint server_members_role_fk foreign key (server_id, role_id)
  references public.server_roles (server_id, id) on delete set null (role_id);
create index server_members_role_idx on public.server_members (role_id) where role_id is not null;

alter table public.server_roles enable row level security;

create policy "turkcord: üyeler sunucu rollerini görür"
  on public.server_roles for select
  to authenticated
  using (private.is_member(server_id));

grant select on public.server_roles to authenticated;

-- ---------------------------------------------------------------------------
-- Fonksiyonlar (sadece sahip ve yöneticiler)
-- ---------------------------------------------------------------------------

create or replace function private.valid_role_input(p_name text, p_color text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(btrim(coalesce(p_name, ''))) between 1 and 30
     and coalesce(p_color, '') ~ '^#[0-9a-f]{6}$';
$$;

create or replace function public.create_server_role(p_server uuid, p_name text, p_color text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role uuid;
begin
  if coalesce(private.member_role(p_server), '') not in ('owner', 'admin') then
    raise exception 'turkcord:forbidden';
  end if;
  if not private.valid_role_input(p_name, lower(p_color)) then
    raise exception 'turkcord:invalid_input';
  end if;
  if (select count(*) from public.server_roles where server_id = p_server) >= 25 then
    raise exception 'turkcord:limit_reached';
  end if;
  insert into public.server_roles (server_id, name, color, position)
  values (
    p_server, btrim(p_name), lower(p_color),
    coalesce((select max(position) + 1 from public.server_roles where server_id = p_server), 0)
  )
  returning id into v_role;
  return v_role;
end;
$$;

create or replace function public.update_server_role(p_role uuid, p_name text, p_color text, p_position int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_server uuid := (select server_id from public.server_roles where id = p_role);
begin
  if v_server is null or coalesce(private.member_role(v_server), '') not in ('owner', 'admin') then
    raise exception 'turkcord:forbidden';
  end if;
  if not private.valid_role_input(p_name, lower(p_color)) or p_position is null or p_position not between 0 and 1000 then
    raise exception 'turkcord:invalid_input';
  end if;
  update public.server_roles
     set name = btrim(p_name), color = lower(p_color), position = p_position
   where id = p_role;
end;
$$;

create or replace function public.delete_server_role(p_role uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_server uuid := (select server_id from public.server_roles where id = p_role);
begin
  if v_server is null or coalesce(private.member_role(v_server), '') not in ('owner', 'admin') then
    raise exception 'turkcord:forbidden';
  end if;
  delete from public.server_roles where id = p_role;
end;
$$;

-- Üyeye rol verir; p_role null ise rolü kaldırır. Yönetici, sahibin rolünü değiştiremez.
create or replace function public.set_member_server_role(p_server uuid, p_user uuid, p_role uuid)
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
  if coalesce(v_my_role, '') not in ('owner', 'admin') or (v_their_role = 'owner' and v_my_role <> 'owner') then
    raise exception 'turkcord:forbidden';
  end if;
  if v_their_role is null then
    raise exception 'turkcord:not_found';
  end if;
  if p_role is not null and not exists (select 1 from public.server_roles where id = p_role and server_id = p_server) then
    raise exception 'turkcord:invalid_input';
  end if;
  update public.server_members set role_id = p_role where server_id = p_server and user_id = p_user;
end;
$$;

revoke all on function private.valid_role_input(text, text) from public;
revoke all on function public.create_server_role(uuid, text, text) from public, anon;
revoke all on function public.update_server_role(uuid, text, text, int) from public, anon;
revoke all on function public.delete_server_role(uuid) from public, anon;
revoke all on function public.set_member_server_role(uuid, uuid, uuid) from public, anon;

grant execute on function private.valid_role_input(text, text) to authenticated;
grant execute on function public.create_server_role(uuid, text, text) to authenticated;
grant execute on function public.update_server_role(uuid, text, text, int) to authenticated;
grant execute on function public.delete_server_role(uuid) to authenticated;
grant execute on function public.set_member_server_role(uuid, uuid, uuid) to authenticated;

-- Rol değişiklikleri anında herkese yansısın.
alter publication supabase_realtime add table public.server_roles;
