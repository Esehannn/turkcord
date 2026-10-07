-- Turkcord 08: Supabase güvenlik/performans denetimi düzeltmeleri

-- "Otomatik RLS" seçeneğiyle gelen olay tetikleyicisi fonksiyonu API'den çağrılabilir görünmesin.
-- (Olay tetikleyicisi fonksiyonları zaten doğrudan çalıştırılamaz; bu sadece gereksiz yetkiyi kaldırır.)
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- Yabancı anahtarlar için eksik indeksler.
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists server_invites_created_by_idx on public.server_invites (created_by);
create index if not exists invites_created_by_idx on private.invites (created_by);
