import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '@/components/Modal'
import { Button, Field, Input, Tabs } from '@/components/ui'
import { useActions } from '@/data/actions'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/data/queries'
import { useSession } from '@/stores/session'

type Preview = { name: string; member_count: number; already_member: boolean } | null

export function CreateServerModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create')
  return (
    <Modal title="Sunucu" subtitle="Kendi sunucunu kur ya da bir davet koduyla katıl." onClose={onClose}>
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'create', label: 'Oluştur' },
            { value: 'join', label: 'Katıl' },
          ]}
        />
      </div>
      {tab === 'create' ? <CreateForm onClose={onClose} /> : <JoinForm onClose={onClose} />}
    </Modal>
  )
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const me = useProfile(useSession((s) => s.session?.user.id))
  const [name, setName] = useState(me ? `${me.display_name} sunucusu` : '')
  const [busy, setBusy] = useState(false)
  const actions = useActions()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await actions.createServer(name.trim())
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Sunucu adı" hint="İçinde #genel, #sohbet yazı kanalları ve Kahvehane ses kanalı hazır gelir.">
        <Input autoFocus maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Oluştur
        </Button>
      </div>
    </form>
  )
}

function JoinForm({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<Preview>(null)
  const [busy, setBusy] = useState(false)
  const actions = useActions()

  // Kod yazılınca hangi sunucuya ait olduğunu göster.
  useEffect(() => {
    const clean = code.replace(/[^A-Za-z0-9]/g, '')
    setPreview(null)
    if (clean.length < 8) return
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('preview_server_invite', { p_code: clean })
      setPreview(data?.[0] ?? null)
    }, 300)
    return () => clearTimeout(timer)
  }, [code])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    try {
      await actions.joinServer(code.trim())
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Davet kodu" hint="Örnek: K7MPQ2XA">
        <Input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} spellCheck={false} />
      </Field>
      {preview && (
        <div className="rounded-lg border border-line bg-sidebar p-3 text-sm">
          <p className="font-semibold text-fg">{preview.name}</p>
          <p className="text-muted">
            {preview.member_count} üye{preview.already_member ? ' · zaten üyesin' : ''}
          </p>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!code.trim()}>
          Katıl
        </Button>
      </div>
    </form>
  )
}
