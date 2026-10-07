import { Crown, Shield } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { useMembers, useProfiles } from '@/data/queries'
import type { MemberRole, ProfileRow } from '@/lib/database.types'
import { usePresence } from '@/stores/presence'
import { useUi } from '@/stores/ui'

const ROLE_ORDER: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 }

export function MemberList({ serverId }: { serverId: string }) {
  const { data: members = [] } = useMembers(serverId)
  const { data: profiles } = useProfiles()
  const online = usePresence((s) => s.online)

  const rows = members
    .map((m) => ({ member: m, profile: profiles?.get(m.user_id) }))
    .filter((r): r is { member: typeof r.member; profile: ProfileRow } => !!r.profile)
    .sort(
      (a, b) =>
        ROLE_ORDER[a.member.role] - ROLE_ORDER[b.member.role] ||
        a.profile.display_name.localeCompare(b.profile.display_name, 'tr'),
    )

  const onlineRows = rows.filter((r) => online[r.member.user_id])
  const offlineRows = rows.filter((r) => !online[r.member.user_id])

  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-l border-line bg-sidebar px-2 py-4 scroll-thin" aria-label="Üyeler">
      <Group title={`Çevrimiçi — ${onlineRows.length}`} rows={onlineRows} />
      {offlineRows.length > 0 && <Group title={`Çevrimdışı — ${offlineRows.length}`} rows={offlineRows} dim />}
    </aside>
  )
}

function Group({ title, rows, dim = false }: { title: string; rows: { member: { role: MemberRole }; profile: ProfileRow }[]; dim?: boolean }) {
  const openModal = useUi((s) => s.openModal)
  return (
    <section className="mb-4">
      <p className="px-2 pb-1 text-xs font-bold tracking-wide text-faint uppercase">{title}</p>
      {rows.map(({ member, profile }) => (
        <button
          key={profile.id}
          type="button"
          onClick={() => openModal({ kind: 'profile', userId: profile.id })}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover ${dim ? 'opacity-50 hover:opacity-100' : ''}`}
        >
          <Avatar name={profile.display_name} path={profile.avatar_path} userId={profile.id} size={32} showStatus />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-sm font-medium text-fg">
              <span className="truncate">{profile.display_name}</span>
              {member.role === 'owner' && <Crown className="size-3.5 shrink-0 text-idle" aria-label="Sunucu sahibi" />}
              {member.role === 'admin' && <Shield className="size-3.5 shrink-0 text-accent" aria-label="Yönetici" />}
            </span>
            {profile.custom_status && <span className="block truncate text-xs text-faint">{profile.custom_status}</span>}
          </span>
        </button>
      ))}
    </section>
  )
}
