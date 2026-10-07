-- Turkcord 07: güvenlik sıkılaştırma
--  * Kayıt ön kontrolü önce davet kodunu doğrular: kodu olmayan biri hangi kullanıcı adlarının
--    alındığını yoklayamaz.
--  * Edge Function'lar için basit istek sınırı (ör. aynı IP'den saatte 10 kayıt denemesi).

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
  if not exists (
    select 1 from private.invites
     where code = private.normalize_code(p_code)
       and revoked_at is null
       and uses < max_uses
       and (expires_at is null or expires_at > now())
  ) then
    return 'invalid_invite';
  end if;
  if v_username !~ '^[a-z0-9_.]{3,20}$' then
    return 'invalid_username';
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    return 'username_taken';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.check_registration(text, text) from public, anon, authenticated;
grant execute on function public.check_registration(text, text) to service_role;

create table private.rate_limits (
  key text primary key,
  hits int not null,
  window_start timestamptz not null
);

alter table private.rate_limits enable row level security;

-- Sayaç penceresi dolana kadar her çağrıda bir artırır. Dönüş: true = devam edilebilir, false = sınır aşıldı.
create or replace function public.hit_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hits int;
  v_window interval := make_interval(secs => p_window_seconds);
begin
  insert into private.rate_limits as r (key, hits, window_start)
  values (left(p_key, 200), 1, now())
  on conflict (key) do update
    set hits = case when r.window_start < now() - v_window then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - v_window then now() else r.window_start end
  returning hits into v_hits;

  -- Tablo şişmesin diye ara sıra eski kayıtları temizle.
  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end;
$$;

revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- Okunmamış sayılarına sunucu bilgisi eklenir (sunucu simgesindeki kırmızı nokta için).
drop function public.unread_counts();

create function public.unread_counts()
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
         least(count(m.id) filter (where position(lower((select tag from me)) in lower(m.content)) > 0), 99)::int
    from my_channels mc
    left join public.channel_reads r on r.channel_id = mc.id and r.user_id = (select uid from me)
    join public.messages m
      on m.channel_id = mc.id
     and m.created_at > greatest(coalesce(r.last_read_at, '-infinity'::timestamptz), mc.since)
     and m.author_id is distinct from (select uid from me)
   group by mc.id, mc.server_id;
$$;

revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;
