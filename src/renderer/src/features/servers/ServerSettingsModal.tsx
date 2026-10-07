import { useRef, useState } from 'react'
import { Crown, Shield, UserX } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { confirmDialog, Modal } from '@/components/Modal'
import { Button, Field, IconButton, Input } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useMembers, useProfiles, useServers } from '@/data/queries'
import { initials } from '@/lib/format'
import { removeImage, uploadServerIcon } from '@/lib/images'
import { publicImageUrl } from '@/lib/supabase'
import { useSession } from '@/stores/session'
import { toast } from '@/stores/toast'

export function ServerSettingsModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const me = useSession((s) => s.session?.user.id)
  const server = useServers().data?.find((s) => s.id === serverId)
  const { data: members = [] } = useMembers(serverId)
  const { data: profiles } = useProfiles()
  const actions = useActions()
  const [name, setName] = useState(server?.name ?? '')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!server) return null
  const myRole = members.find((m) => m.user_id === me)?.role
  const icon = publicImageUrl(server.icon_path)

  async function saveName() {
    if (!name.trim() || name.trim() === server!.name) return
    setBusy(true)
    try {
      await actions.updateServer(serverId, { name: name.trim() })
      toast.success('Sunucu adı güncellendi.')
    } finally {
      setBusy(false)
    }
  }

  async function changeIcon(file: File) {
    setBusy(true)
    try {
      const path = await uploadServerIcon(serverId, file)
      const old = server!.icon_path
      await actions.updateServer(serverId, { icon_path: path })
      void removeImage('gorseller', old)
      toast.success('Sunucu simgesi güncellendi.')
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...members].sort((a, b) =>
    (profiles?.get(a.user_id)?.display_name ?? '').localeCompare(profiles?.get(b.user_id)?.display_name ?? '', 'tr'),
  )

  return (
    <Modal title="Sunucu ayarları" onClose={onClose} width="max-w-lg">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-accent text-xl font-bold text-white"
            title="Simgeyi değiştir"
          >
            {icon ? <img src={icon} alt="" className="size-full object-cover" /> : initials(server.name)}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void changeIcon(file)
              e.target.value = ''
            }}
          />
          <div className="flex-1">
            <Field label="Sunucu adı">
              <div className="flex gap-2">
                <Input maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
                <Button onClick={() => void saveName()} loading={busy} disabled={!name.trim() || name.trim() === server.name}>
                  Kaydet
                </Button>
              </div>
            </Field>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Üyeler — {members.length}</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {sorted.map((m) => {
              const p = profiles?.get(m.user_id)
              if (!p) return null
              const canKick = m.user_id !== me && m.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && m.role === 'member'))
              return (
                <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={p.display_name} path={p.avatar_path} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-sm font-medium text-fg">
                      {p.display_name}
                      {m.role === 'owner' && <Crown className="size-3.5 text-idle" />}
                      {m.role === 'admin' && <Shield className="size-3.5 text-accent" />}
                    </p>
                    <p className="text-xs text-faint">@{p.username}</p>
                  </div>
                  {myRole === 'owner' && m.role !== 'owner' && (
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => void actions.setMemberRole(serverId, m.user_id, m.role === 'admin' ? 'member' : 'admin')}
                    >
                      {m.role === 'admin' ? 'Yöneticiliği al' : 'Yönetici yap'}
                    </Button>
                  )}
                  {canKick && (
                    <IconButton
                      label="Sunucudan at"
                      className="hover:text-accent"
                      onClick={async () => {
                        if (await confirmDialog({ title: 'Sunucudan at', text: `${p.display_name} sunucudan atılsın mı? Davet koduyla tekrar katılabilir.`, confirmLabel: 'At' }))
                          void actions.kickMember(serverId, m.user_id)
                      }}
                    >
                      <UserX className="size-4" />
                    </IconButton>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </Modal>
  )
}
