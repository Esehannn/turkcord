import { useState, type FormEvent, type ReactNode } from 'react'
import { Check, MessageCircle, Phone, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { Avatar, STATUS_LABEL } from '@/components/Avatar'
import { confirmDialog } from '@/components/Modal'
import { TeaGlass } from '@/components/TeaGlass'
import { Badge, Button, EmptyState, IconButton, Input } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useBlocks, useFriendships, useProfiles } from '@/data/queries'
import type { ProfileRow } from '@/lib/database.types'
import { usePresence } from '@/stores/presence'
import { useSession } from '@/stores/session'
import { useUi, type FriendsTab } from '@/stores/ui'
import { startCall } from '@/voice/call'

export function FriendsView() {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const tab: FriendsTab = view.kind === 'home' ? view.tab : 'online'
  const me = useSession((s) => s.session?.user.id) ?? ''
  const { data: friendships = [] } = useFriendships()
  const pendingIncoming = friendships.filter((f) => f.status === 'pending' && f.addressee_id === me).length

  const tabs: { value: FriendsTab; label: ReactNode }[] = [
    { value: 'online', label: 'Çevrimiçi' },
    { value: 'all', label: 'Tümü' },
    {
      value: 'pending',
      label: (
        <span className="flex items-center gap-1.5">
          Bekleyen <Badge count={pendingIncoming} />
        </span>
      ),
    },
    { value: 'blocked', label: 'Engellenen' },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-4">
        <div className="flex items-center gap-2 font-semibold text-fg">
          <Users className="size-5 text-muted" />
          Arkadaşlar
        </div>
        <div className="h-6 w-px bg-line" />
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setView({ kind: 'home', tab: t.value })}
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                tab === t.value ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setView({ kind: 'home', tab: 'add' })}
            className={`ml-1 rounded-md px-2.5 py-1 text-sm font-semibold transition-colors ${
              tab === 'add' ? 'bg-transparent text-accent' : 'bg-accent text-white hover:bg-accent-hover'
            }`}
          >
            Arkadaş Ekle
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scroll-thin">
        {tab === 'add' ? <AddFriend /> : tab === 'blocked' ? <BlockedList /> : <FriendList tab={tab} me={me} />}
      </div>
    </div>
  )
}

function AddFriend() {
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const actions = useActions()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim()) return
    setBusy(true)
    try {
      await actions.sendFriendRequest(username.trim().replace(/^@/, ''))
      setUsername('')
    } catch {
      // bildirim gösterildi
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-bold text-fg">Arkadaş ekle</h2>
      <p className="mt-1 text-sm text-muted">Arkadaşının kullanıcı adını yazarak istek gönderebilirsin.</p>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <Input
          autoFocus
          placeholder="kullanıcı adı"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          className="h-11"
        />
        <Button type="submit" loading={busy} disabled={!username.trim()} className="h-11 shrink-0">
          İstek Gönder
        </Button>
      </form>
    </div>
  )
}

function FriendList({ tab, me }: { tab: 'online' | 'all' | 'pending'; me: string }) {
  const { data: friendships = [], isLoading } = useFriendships()
  const { data: profiles } = useProfiles()
  const online = usePresence((s) => s.online)
  const actions = useActions()

  const other = (f: { requester_id: string; addressee_id: string }) =>
    profiles?.get(f.requester_id === me ? f.addressee_id : f.requester_id)

  let rows = friendships.filter((f) => (tab === 'pending' ? f.status === 'pending' : f.status === 'accepted'))
  if (tab === 'online') rows = rows.filter((f) => !!online[f.requester_id === me ? f.addressee_id : f.requester_id])

  if (isLoading) return null
  if (rows.length === 0) {
    const text = {
      online: { title: 'Şu an çevrimiçi arkadaşın yok', text: 'Çaylar demlenirken birileri gelir elbet.' },
      all: { title: 'Henüz arkadaşın yok', text: '"Arkadaş Ekle" ile kullanıcı adını bildiğin kişilere istek gönder.' },
      pending: { title: 'Bekleyen istek yok', text: 'Gelen ve gönderdiğin istekler burada görünür.' },
    }[tab]
    return <EmptyState icon={tab === 'online' ? <TeaGlass /> : <Users className="size-12" />} title={text.title} text={text.text} />
  }

  const label = { online: 'Çevrimiçi', all: 'Tüm arkadaşlar', pending: 'Bekleyen' }[tab]

  return (
    <div>
      <p className="mb-2 text-xs font-bold tracking-wide text-faint uppercase">
        {label} — {rows.length}
      </p>
      <ul className="divide-y divide-line">
        {rows.map((f) => {
          const profile = other(f)
          if (!profile) return null
          const incoming = f.status === 'pending' && f.addressee_id === me
          return (
            <PersonRow key={f.id} profile={profile} subtitle={f.status === 'pending' ? (incoming ? 'Gelen istek' : 'Gönderilen istek') : undefined}>
              {f.status === 'accepted' && (
                <>
                  <IconButton label="Mesaj gönder" onClick={() => void actions.openDm(profile.id)}>
                    <MessageCircle className="size-5" />
                  </IconButton>
                  <IconButton
                    label="Sesli ara"
                    className="hover:text-success"
                    onClick={async () => {
                      const channelId = await actions.openDm(profile.id).catch(() => null)
                      if (channelId) void startCall(channelId, profile.id)
                    }}
                  >
                    <Phone className="size-5" />
                  </IconButton>
                  <IconButton
                    label="Arkadaşlıktan çıkar"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: 'Arkadaşlıktan çıkar',
                          text: `${profile.display_name} arkadaş listenden çıkarılsın mı?`,
                          confirmLabel: 'Çıkar',
                        })
                      )
                        void actions.removeFriend(profile.id)
                    }}
                  >
                    <UserMinus className="size-5" />
                  </IconButton>
                </>
              )}
              {incoming && (
                <>
                  <IconButton label="Kabul et" className="hover:text-success" onClick={() => void actions.respondFriendRequest(f.id, true)}>
                    <Check className="size-5" />
                  </IconButton>
                  <IconButton label="Reddet" className="hover:text-accent" onClick={() => void actions.respondFriendRequest(f.id, false)}>
                    <X className="size-5" />
                  </IconButton>
                </>
              )}
              {f.status === 'pending' && !incoming && (
                <IconButton label="İsteği geri çek" onClick={() => void actions.removeFriend(profile.id)}>
                  <X className="size-5" />
                </IconButton>
              )}
            </PersonRow>
          )
        })}
      </ul>
    </div>
  )
}

function BlockedList() {
  const { data: blocks = [] } = useBlocks()
  const { data: profiles } = useProfiles()
  const actions = useActions()
  if (blocks.length === 0) {
    return <EmptyState icon={<UserPlus className="size-12" />} title="Engellediğin kimse yok" />
  }
  return (
    <ul className="divide-y divide-line">
      {blocks.map((b) => {
        const profile = profiles?.get(b.blocked_id)
        if (!profile) return null
        return (
          <PersonRow key={b.blocked_id} profile={profile} subtitle="Engellendi">
            <Button variant="secondary" onClick={() => void actions.unblockUser(profile.id)}>
              Engeli kaldır
            </Button>
          </PersonRow>
        )
      })}
    </ul>
  )
}

function PersonRow({ profile, subtitle, children }: { profile: ProfileRow; subtitle?: string; children: ReactNode }) {
  const status = usePresence((s) => s.online[profile.id] ?? 'offline')
  const openModal = useUi((s) => s.openModal)
  return (
    <li className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-hover">
      <button type="button" onClick={() => openModal({ kind: 'profile', userId: profile.id })}>
        <Avatar name={profile.display_name} path={profile.avatar_path} userId={profile.id} size={36} showStatus ringClass="ring-chat" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg">
          {profile.display_name} <span className="font-normal text-faint">@{profile.username}</span>
        </p>
        <p className="truncate text-xs text-muted">{subtitle ?? profile.custom_status ?? STATUS_LABEL[status]}</p>
      </div>
      <div className="flex gap-1">{children}</div>
    </li>
  )
}
