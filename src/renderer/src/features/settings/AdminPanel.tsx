import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, ShieldCheck, ShieldOff, Trash2, UserX, UserCheck } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { confirmDialog, Modal } from '@/components/Modal'
import { Button, Field, IconButton, Input, Tabs } from '@/components/ui'
import { keys, useProfiles } from '@/data/queries'
import { errorMessage, functionErrorCode } from '@/lib/errors'
import { formatMessageTime } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/stores/session'
import { toast } from '@/stores/toast'
import { checkPassword, PASSWORD_MESSAGES } from '@shared/password'

export function AdminPanel() {
  const [tab, setTab] = useState<'invites' | 'users'>('invites')
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-fg">Yönetici</h3>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'invites', label: 'Davet kodları' },
            { value: 'users', label: 'Kullanıcılar' },
          ]}
        />
      </div>
      {tab === 'invites' ? <Invites /> : <Users />}
    </div>
  )
}

const prettyCode = (code: string) => (code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code)

function Invites() {
  const qc = useQueryClient()
  const invites = useQuery({
    queryKey: ['admin-invites'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_invites')
      if (error) throw error
      return data
    },
  })
  const [maxUses, setMaxUses] = useState(1)
  const [hours, setHours] = useState(72)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_create_invite', {
      p_max_uses: maxUses,
      p_expires_hours: hours || null,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) return toast.error(error)
    setCreated(data)
    setNote('')
    void qc.invalidateQueries({ queryKey: ['admin-invites'] })
  }

  async function revoke(id: string) {
    if (!(await confirmDialog({ title: 'Kodu iptal et', text: 'Bu davet koduyla artık kayıt olunamayacak.', confirmLabel: 'İptal et' }))) return
    const { error } = await supabase.rpc('admin_revoke_invite', { p_id: id })
    if (error) return toast.error(error)
    void qc.invalidateQueries({ queryKey: ['admin-invites'] })
  }

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(prettyCode(code))
    toast.success('Davet kodu kopyalandı.')
  }

  const now = Date.now()
  return (
    <div className="space-y-5">
      <form onSubmit={create} className="grid grid-cols-[1fr_1fr_2fr_auto] items-end gap-2 rounded-lg border border-line p-3">
        <Field label="Kişi sayısı">
          <Input type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Süre (saat)">
          <Input type="number" min={0} max={8760} value={hours} onChange={(e) => setHours(Math.max(0, Math.min(8760, Number(e.target.value) || 0)))} />
        </Field>
        <Field label="Not">
          <Input maxLength={100} placeholder="Kimin için?" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy}>
          Oluştur
        </Button>
      </form>
      <p className="-mt-3 text-xs text-faint">Süre 0 ise kod süresiz geçerli olur. Kodu sadece davet ettiğin kişiye gönder.</p>

      {created && (
        <div className="flex items-center gap-2 rounded-lg border border-accent bg-accent-soft p-2 pl-4">
          <span className="selectable flex-1 font-mono text-lg font-bold tracking-widest text-fg">{prettyCode(created)}</span>
          <Button onClick={() => void copy(created)}>
            <Copy className="size-4" /> Kopyala
          </Button>
        </div>
      )}

      <ul className="divide-y divide-line rounded-lg border border-line">
        {(invites.data ?? []).map((inv) => {
          const expired = inv.expires_at && new Date(inv.expires_at).getTime() < now
          const state = inv.revoked_at ? 'İptal edildi' : inv.uses >= inv.max_uses ? 'Kullanıldı' : expired ? 'Süresi doldu' : 'Aktif'
          const active = state === 'Aktif'
          return (
            <li key={inv.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className={`font-mono font-semibold ${active ? 'text-fg' : 'text-faint line-through'}`}>{prettyCode(inv.code)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {state} · {inv.uses}/{inv.max_uses}
                {inv.note ? ` · ${inv.note}` : ''}
                {inv.used_by.length ? ` · ${inv.used_by.map((u) => '@' + u).join(', ')}` : ''}
              </span>
              {active && (
                <>
                  <IconButton label="Kopyala" onClick={() => void copy(inv.code)}>
                    <Copy className="size-4" />
                  </IconButton>
                  <IconButton label="İptal et" className="hover:text-accent" onClick={() => void revoke(inv.id)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </>
              )}
            </li>
          )
        })}
        {invites.data?.length === 0 && <li className="px-3 py-4 text-center text-sm text-faint">Henüz davet kodu yok.</li>}
      </ul>
    </div>
  )
}

type AuthInfo = { id: string; banned_until: string | null; last_sign_in_at: string | null }

async function callAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('yonetici', { body })
  if (error) throw new Error(errorMessage((await functionErrorCode(error)) ?? error))
  return data as T
}

function Users() {
  const qc = useQueryClient()
  const me = useSession((s) => s.session?.user.id)
  const { data: profiles } = useProfiles()
  const auth = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => new Map((await callAdmin<{ users: AuthInfo[] }>({ action: 'list_users' })).users.map((u) => [u.id, u])),
  })
  const [resetFor, setResetFor] = useState<{ id: string; name: string } | null>(null)

  const run = async (body: Record<string, unknown>, success: string) => {
    try {
      await callAdmin(body)
      toast.success(success)
      void qc.invalidateQueries({ queryKey: ['admin-users'] })
      void qc.invalidateQueries({ queryKey: keys.profiles })
    } catch (error) {
      toast.error(error)
    }
  }

  const setAdmin = async (id: string, value: boolean) => {
    const { error } = await supabase.rpc('admin_set_admin', { p_user: id, p_value: value })
    if (error) return toast.error(error)
    void qc.invalidateQueries({ queryKey: keys.profiles })
  }

  const list = [...(profiles?.values() ?? [])].sort((a, b) => a.username.localeCompare(b.username))

  return (
    <>
      {auth.isError && <p className="text-sm text-accent">{errorMessage(auth.error)}</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {list.map((p) => {
          const info = auth.data?.get(p.id)
          const banned = !!info?.banned_until && new Date(info.banned_until).getTime() > Date.now()
          const isMe = p.id === me
          return (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar name={p.display_name} path={p.avatar_path} size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
                  {p.display_name} <span className="font-normal text-faint">@{p.username}</span>
                  {p.is_admin && <ShieldCheck className="size-3.5 text-accent" aria-label="Yönetici" />}
                  {banned && <span className="rounded bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">Askıda</span>}
                </p>
                <p className="text-xs text-faint">
                  Son giriş: {info?.last_sign_in_at ? formatMessageTime(info.last_sign_in_at) : 'bilinmiyor'}
                </p>
              </div>
              {!isMe && (
                <div className="flex gap-0.5">
                  <IconButton label="Şifre sıfırla" onClick={() => setResetFor({ id: p.id, name: p.display_name })}>
                    <KeyRound className="size-4" />
                  </IconButton>
                  <IconButton label={p.is_admin ? 'Yöneticiliği al' : 'Yönetici yap'} onClick={() => void setAdmin(p.id, !p.is_admin)}>
                    {p.is_admin ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
                  </IconButton>
                  <IconButton
                    label={banned ? 'Askıyı kaldır' : 'Hesabı askıya al'}
                    onClick={async () => {
                      if (
                        banned ||
                        (await confirmDialog({ title: 'Askıya al', text: `${p.display_name} giriş yapamayacak.`, confirmLabel: 'Askıya al' }))
                      )
                        void run({ action: 'set_banned', user_id: p.id, banned: !banned }, banned ? 'Askı kaldırıldı.' : 'Hesap askıya alındı.')
                    }}
                  >
                    {banned ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
                  </IconButton>
                  <IconButton
                    label="Hesabı sil"
                    className="hover:text-accent"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: 'Hesabı sil',
                          text: `${p.display_name} hesabı kalıcı olarak silinecek. Sahibi olduğu sunucular da silinir; mesajları "Silinmiş kullanıcı" olarak kalır.`,
                          confirmLabel: 'Kalıcı olarak sil',
                        })
                      )
                        void run({ action: 'delete_user', user_id: p.id }, 'Hesap silindi.')
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
    </>
  )
}

function ResetPasswordModal({ user, onClose }: { user: { id: string; name: string }; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const problem = password ? checkPassword(password) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!password || problem) return
    setBusy(true)
    try {
      await callAdmin({ action: 'reset_password', user_id: user.id, password })
      toast.success(`${user.name} için yeni şifre belirlendi. Şifreyi kendisine güvenli bir yoldan ilet.`)
      onClose()
    } catch (error) {
      toast.error(error)
      setBusy(false)
    }
  }

  return (
    <Modal title="Şifre sıfırla" subtitle={`${user.name} için yeni bir geçici şifre belirle.`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Yeni şifre" error={problem ? PASSWORD_MESSAGES[problem] : null} hint="Kullanıcı girdikten sonra Ayarlar > Hesap'tan değiştirebilir.">
          <Input autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!password || !!problem}>
            Şifreyi belirle
          </Button>
        </div>
      </form>
    </Modal>
  )
}
