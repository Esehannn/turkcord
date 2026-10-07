-- Turkcord 01: temel
-- Profiller, davet kodları, davetsiz kaydı engelleyen tetikleyiciler ve yönetici fonksiyonları.
--
-- Güvenlik notları:
--  * Bu projede "yeni tablolar otomatik açılsın" kapalı: hiçbir tabloya/fonksiyona varsayılan erişim yok,
--    her yetki aşağıda açıkça veriliyor.
--  * `private` şeması Data API'de (PostgREST) yayınlanmaz; hassas tablolar ve yardımcılar orada durur.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------

-- Karışmayan 32 karakterden (I, O, 0, 1 yok) rastgele kod üretir. 256 % 32 = 0 olduğu için dağılım eşit.
create or replace function private.random_code(len int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(len);
  result text := '';
begin
  for i in 0 .. len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

-- Kullanıcıdan gelen kodu karşılaştırılabilir hale getirir: boşluk/tire atılır, büyük harfe çevrilir.
create or replace function private.normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Hatalı metni uuid'ye çevirmeye çalışırken hata fırlatmak yerine null döner (Realtime konu adları için).
create or replace function private.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiller
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    constraint profiles_username_format check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text not null
    constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 32),
  avatar_path text
    constraint profiles_avatar_path_owner check (avatar_path is null or avatar_path like 'u/' || id::text || '/%'),
  custom_status text
    constraint profiles_custom_status_length check (char_length(custom_status) <= 80),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Giriş yapan herkes profilleri görebilir"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Kullanıcı kendi profilini düzenleyebilir"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Kullanıcı adı ve yöneticilik kullanıcı tarafından değiştirilemez: sadece bu sütunlara yazma izni var.
grant select on public.profiles to authenticated;
grant update (display_name, avatar_path, custom_status) on public.profiles to authenticated;
grant select on public.profiles to service_role;

-- ---------------------------------------------------------------------------
-- Davet kodları (uygulamaya kayıt için)
-- ---------------------------------------------------------------------------

create table private.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  note text constraint invites_note_length check (char_length(note) <= 100),
  max_uses int not null default 1 constraint invites_max_uses_range check (max_uses between 1 and 100),
  uses int not null default 0 constraint invites_uses_nonnegative check (uses >= 0),
  grants_admin boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table private.invite_uses (
  invite_id uuid not null references private.invites (id) on delete cascade,
  user_id uuid not null,
  used_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

alter table private.invites enable row level security;
alter table private.invite_uses enable row level security;

-- ---------------------------------------------------------------------------
-- Kayıt koruması: auth.users'a eklenen her kullanıcı geçerli bir davet kodu getirmek zorunda.
-- Hem Edge Function (admin API) hem de doğrudan signUp çağrısı bu kontrolden geçer.
-- ---------------------------------------------------------------------------

create or replace function private.handle_auth_user_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := private.normalize_code(new.raw_user_meta_data ->> 'invite_code');
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_invite_id uuid;
begin
  if v_username !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'turkcord:invalid_username';
  end if;

  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'turkcord:username_taken';
  end if;

  update private.invites
     set uses = uses + 1
   where code = v_code
     and revoked_at is null
     and uses < max_uses
     and (expires_at is null or expires_at > now())
  returning id into v_invite_id;

  if v_invite_id is null then
    raise exception 'turkcord:invalid_invite';
  end if;

  insert into private.invite_uses (invite_id, user_id) values (v_invite_id, new.id);

  -- Davet kodu kullanıcı verisinde (ve oturum anahtarında) saklanmasın.
  new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite_code')
                            || jsonb_build_object('username', v_username);
  return new;
end;
$$;

create or replace function private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := new.raw_user_meta_data ->> 'username';
  v_display text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  v_admin boolean;
begin
  select coalesce(bool_or(i.grants_admin), false)
    into v_admin
    from private.invite_uses u
    join private.invites i on i.id = u.invite_id
   where u.user_id = new.id;

  insert into public.profiles (id, username, display_name, is_admin)
  values (new.id, v_username, left(coalesce(v_display, v_username), 32), v_admin);

  return new;
end;
$$;

create trigger turkcord_before_user_insert
  before insert on auth.users
  for each row execute function private.handle_auth_user_insert();

create trigger turkcord_after_user_insert
  after insert on auth.users
  for each row execute function private.handle_auth_user_created();

-- Edge Function'ın kayıttan önce kullanıcıya anlaşılır hata gösterebilmesi için ön kontrol.
-- Sadece service_role çağırabilir.
create or replace function public.check_registration(p_username text, p_code text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if v_username !~ '^[a-z0-9_.]{3,20}$' then
    return 'invalid_username';
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    return 'username_taken';
  end if;
  if not exists (
    select 1 from private.invites
     where code = private.normalize_code(p_code)
       and revoked_at is null
       and uses < max_uses
       and (expires_at is null or expires_at > now())
  ) then
    return 'invalid_invite';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.check_registration(text, text) from public, anon, authenticated;
grant execute on function public.check_registration(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Yönetici fonksiyonları
-- ---------------------------------------------------------------------------

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false);
$$;

create or replace function public.admin_create_invite(
  p_max_uses int default 1,
  p_expires_hours int default 72,
  p_note text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_admin() then
    raise exception 'turkcord:forbidden';
  end if;
  if p_max_uses is null or p_max_uses not between 1 and 100 then
    raise exception 'turkcord:invalid_input';
  end if;
  if p_expires_hours is not null and p_expires_hours not between 1 and 8760 then
    raise exception 'turkcord:invalid_input';
  end if;

  loop
    v_code := private.random_code(10);
    begin
      insert into private.invites (code, note, max_uses, expires_at, created_by)
      values (
        v_code,
        nullif(btrim(p_note), ''),
        p_max_uses,
        case when p_expires_hours is null then null else now() + make_interval(hours => p_expires_hours) end,
        (select auth.uid())
      );
      exit;
    exception when unique_violation then
      -- Aynı kod tekrar üretildiyse (çok düşük ihtimal) yeniden dene.
    end;
  end loop;

  return v_code;
end;
$$;

create or replace function public.admin_list_invites()
returns table (
  id uuid,
  code text,
  note text,
  max_uses int,
  uses int,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  created_by_username text,
  used_by text[]
)
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
    select i.id, i.code, i.note, i.max_uses, i.uses, i.expires_at, i.revoked_at, i.created_at,
           c.username,
           coalesce(array_agg(p.username order by u.used_at) filter (where p.username is not null), '{}')
      from private.invites i
      left join public.profiles c on c.id = i.created_by
      left join private.invite_uses u on u.invite_id = i.id
      left join public.profiles p on p.id = u.user_id
     group by i.id, c.username
     order by i.created_at desc
     limit 200;
end;
$$;

create or replace function public.admin_revoke_invite(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'turkcord:forbidden';
  end if;
  update private.invites set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;

create or replace function public.admin_set_admin(p_user uuid, p_value boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'turkcord:forbidden';
  end if;
  if not p_value and (select count(*) from public.profiles where is_admin) <= 1
     and exists (select 1 from public.profiles where id = p_user and is_admin) then
    raise exception 'turkcord:last_admin';
  end if;
  update public.profiles set is_admin = p_value where id = p_user;
end;
$$;

-- Fonksiyonlara varsayılan erişim yok; sadece gerekenler açılıyor.
revoke all on function private.random_code(int) from public;
revoke all on function private.normalize_code(text) from public;
revoke all on function private.try_uuid(text) from public;
revoke all on function private.is_admin() from public;
revoke all on function private.handle_auth_user_insert() from public;
revoke all on function private.handle_auth_user_created() from public;
grant execute on function private.try_uuid(text) to authenticated;
grant execute on function private.is_admin() to authenticated;

revoke all on function public.admin_create_invite(int, int, text) from public, anon;
revoke all on function public.admin_list_invites() from public, anon;
revoke all on function public.admin_revoke_invite(uuid) from public, anon;
revoke all on function public.admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_create_invite(int, int, text) to authenticated;
grant execute on function public.admin_list_invites() to authenticated;
grant execute on function public.admin_revoke_invite(uuid) to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
