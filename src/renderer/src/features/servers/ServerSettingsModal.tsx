import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Crown, ImagePlus, Settings, Shield, Tag, Trash2, Users, UserX } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { confirmDialog, Modal } from '@/components/Modal'
import { Button, Field, IconButton, Input } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useMembers, useProfiles, useServerRoles, useServers } from '@/data/queries'
import type { ServerRoleRow } from '@/lib/database.types'
import { initials } from '@/lib/format'
import { removeImage, uploadServerIcon } from '@/lib/images'
import { publicImageUrl } from '@/lib/supabase'
import { useSession } from '@/stores/session'
import { toast } from '@/stores/toast'

type Tab = 'general' | 'roles' | 'members'

// Hem açık hem koyu temada okunan renkler.
export const ROLE_COLORS = ['#e30a17', '#c2410c', '#b45309', '#15803d', '#0f766e', '#0369a1', '#4f46e5', '#7c3aed', '#be185d', '#64748b']

export function ServerSettingsModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const me = useSession((s) => s.session?.user.id)
  const server = useServers().data?.find((s) => s.id === serverId)
  const { data: members = [] } = useMembers(serverId)
  const [tab, setTab] = useState<Tab>('general')

  if (!server) return null
  const myRole = members.find((m) => m.user_id === me)?.role

  const tabs = [
    { value: 'general', label: 'Genel', icon: Settings },
    { value: 'roles', label: 'Roller', icon: Tag },
    { value: 'members', label: `Üyeler (${members.length})`, icon: Users },
  ] as const

  return (
    <Modal title="Sunucu ayarları" onClose={onClose} width="max-w-2xl">
      <div className="flex min-h-[400px] gap-6">
        <nav className="w-40 shrink-0 space-y-0.5">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                tab === t.value ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'general' && <GeneralTab serverId={serverId} />}
          {tab === 'roles' && <RolesTab serverId={serverId} />}
          {tab === 'members' && <MembersTab serverId={serverId} me={me ?? ''} myRole={myRole} />}
        </div>
      </div>
    </Modal>
  )
}

function GeneralTab({ serverId }: { serverId: string }) {
  const server = useServers().data?.find((s) => s.id === serverId)
  const actions = useActions()
  const [name, setName] = useState(server?.name ?? '')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!server) return null
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
      toast.success('Sunucu fotoğrafı güncellendi.')
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }

  async function removeIcon() {
    const old = server!.icon_path
    await actions.updateServer(serverId, { icon_path: null })
    void removeImage('gorseller', old)
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-3xl bg-accent text-2xl font-bold text-white"
          title="Fotoğrafı değiştir"
        >
          {icon ? <img src={icon} alt="" className="size-full object-cover" /> : initials(server.name)}
          <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <ImagePlus className="size-6" />
          </span>
        </button>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-fg">Sunucu fotoğrafı</p>
          <p className="text-xs text-muted">Kare bir görsel en iyisi. PNG, JPG, WEBP ya da GIF, en fazla 2 MB.</p>
          <div className="flex gap-2">
            <Button className="h-8 px-3 text-xs" loading={busy} onClick={() => fileRef.current?.click()}>
              Fotoğraf yükle
            </Button>
            {server.icon_path && (
              <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => void removeIcon()}>
                Kaldır
              </Button>
            )}
          </div>
        </div>
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
      </div>

      <Field label="Sunucu adı">
        <div className="flex gap-2">
          <Input maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={() => void saveName()} loading={busy} disabled={!name.trim() || name.trim() === server.name}>
            Kaydet
          </Button>
        </div>
      </Field>
    </section>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ROLE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Renk ${c}`}
          onClick={() => onChange(c)}
          className={`size-6 rounded-full ring-offset-2 ring-offset-elevated transition-transform hover:scale-110 ${value === c ? 'ring-2 ring-fg' : ''}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <label className="relative size-6 cursor-pointer overflow-hidden rounded-full border border-line" title="Başka renk">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute -inset-2 size-10 cursor-pointer" />
      </label>
    </div>
  )
}

function RolesTab({ serverId }: { serverId: string }) {
  const { data: roles = [] } = useServerRoles(serverId)
  const { data: members = [] } = useMembers(serverId)
  const actions = useActions()
  const [name, setName] = useState('')
  const [color, setColor] = useState(ROLE_COLORS[5])
  const [editing, setEditing] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    await actions.createRole(serverId, name.trim(), color)
    setName('')
  }

  // Sırayı değiştir: iki rolün yerini takas eder.
  async function move(index: number, step: -1 | 1) {
    const a = roles[index]
    const b = roles[index + step]
    if (!a || !b) return
    await actions.updateRole(serverId, a.id, a.name, a.color, index + step)
    await actions.updateRole(serverId, b.id, b.name, b.color, index)
  }

  return (
    <section className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-fg">Roller</h3>
        <p className="text-sm text-muted">
          "Çaycı", "Oyuncu" gibi renkli roller oluşturup üyelere ver. Üye listesinde rollere göre gruplanır, sohbette isimler rol renginde görünür.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-line p-3">
        <div className="flex gap-2">
          <Input maxLength={30} placeholder="Rol adı" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
          <Button onClick={() => void create()} disabled={!name.trim() || roles.length >= 25}>
            Oluştur
          </Button>
        </div>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      {roles.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">Henüz rol yok.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {roles.map((role, i) => (
            <li key={role.id} className="p-3">
              {editing === role.id ? (
                <RoleEditor serverId={serverId} role={role} position={i} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex items-center gap-3">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: role.color }} />
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-semibold" style={{ color: role.color }} onClick={() => setEditing(role.id)}>
                    {role.name}
                  </button>
                  <span className="text-xs text-faint">{members.filter((m) => m.role_id === role.id).length} kişi</span>
                  <IconButton label="Yukarı taşı" className="size-7" disabled={i === 0} onClick={() => void move(i, -1)}>
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton label="Aşağı taşı" className="size-7" disabled={i === roles.length - 1} onClick={() => void move(i, 1)}>
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label="Rolü sil"
                    className="size-7 hover:text-accent"
                    onClick={async () => {
                      if (await confirmDialog({ title: 'Rolü sil', text: `"${role.name}" rolü silinsin mi? Bu role sahip üyelerden de kalkar.`, confirmLabel: 'Sil' }))
                        void actions.deleteRole(serverId, role.id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-faint">Rol vermek için "Üyeler" sekmesini kullan. Yetkiler (kanal açma, üye atma) "Yönetici" ile verilir.</p>
    </section>
  )
}

function RoleEditor({ serverId, role, position, onDone }: { serverId: string; role: ServerRoleRow; position: number; onDone: () => void }) {
  const actions = useActions()
  const [name, setName] = useState(role.name)
  const [color, setColor] = useState(role.color)
  async function save() {
    if (!name.trim()) return
    await actions.updateRole(serverId, role.id, name.trim(), color, position)
    onDone()
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input autoFocus maxLength={30} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <Button onClick={() => void save()} disabled={!name.trim()}>
          Kaydet
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Vazgeç
        </Button>
      </div>
      <ColorPicker value={color} onChange={setColor} />
    </div>
  )
}

function MembersTab({ serverId, me, myRole }: { serverId: string; me: string; myRole: string | undefined }) {
  const { data: members = [] } = useMembers(serverId)
  const { data: roles = [] } = useServerRoles(serverId)
  const { data: profiles } = useProfiles()
  const actions = useActions()
  const [filter, setFilter] = useState('')

  const q = filter.trim().toLocaleLowerCase('tr-TR')
  const sorted = [...members]
    .filter((m) => {
      if (!q) return true
      const p = profiles?.get(m.user_id)
      return !!p && (p.display_name.toLocaleLowerCase('tr-TR').includes(q) || p.username.includes(q))
    })
    .sort((a, b) =>
      (profiles?.get(a.user_id)?.display_name ?? '').localeCompare(profiles?.get(b.user_id)?.display_name ?? '', 'tr'),
    )

  return (
    <section className="space-y-3">
      {members.length > 8 && <Input placeholder="Üye ara" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {sorted.map((m) => {
          const p = profiles?.get(m.user_id)
          if (!p) return null
          const canKick = m.user_id !== me && m.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && m.role === 'member'))
          const canSetRole = m.role !== 'owner' || myRole === 'owner'
          const role = roles.find((r) => r.id === m.role_id)
          return (
            <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
              <Avatar name={p.display_name} path={p.avatar_path} size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-sm font-medium">
                  <span className="truncate text-fg" style={role ? { color: role.color } : undefined}>
                    {p.display_name}
                  </span>
                  {m.role === 'owner' && <Crown className="size-3.5 shrink-0 text-idle" aria-label="Sunucu sahibi" />}
                  {m.role === 'admin' && <Shield className="size-3.5 shrink-0 text-accent" aria-label="Yönetici" />}
                </p>
                <p className="text-xs text-faint">@{p.username}</p>
              </div>
              <select
                aria-label="Rol"
                disabled={!canSetRole || roles.length === 0}
                value={m.role_id ?? ''}
                onChange={(e) => void actions.setMemberServerRole(serverId, m.user_id, e.target.value || null)}
                className="h-8 max-w-36 rounded-md border border-line bg-input px-2 text-xs text-fg disabled:opacity-50"
              >
                <option value="">{roles.length ? 'Rol yok' : 'Önce rol oluştur'}</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {myRole === 'owner' && m.role !== 'owner' && (
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  title="Yönetici; kanal açıp düzenleyebilir, üye atabilir, mesaj silebilir, rol verebilir."
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
    </section>
  )
}
