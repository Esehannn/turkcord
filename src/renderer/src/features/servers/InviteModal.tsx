import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Button, Field } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useServers } from '@/data/queries'
import { toast } from '@/stores/toast'

const EXPIRY = [
  { label: '1 saat', hours: 1 },
  { label: '1 gün', hours: 24 },
  { label: '7 gün', hours: 168 },
  { label: 'Süresiz', hours: null },
]
const USES = [
  { label: 'Sınırsız', value: null },
  { label: '1 kişi', value: 1 },
  { label: '5 kişi', value: 5 },
  { label: '25 kişi', value: 25 },
]

export function InviteModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const server = useServers().data?.find((s) => s.id === serverId)
  const actions = useActions()
  const [expiry, setExpiry] = useState<number | null>(168)
  const [uses, setUses] = useState<number | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      setCode(await actions.createInvite(serverId, uses, expiry))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!code) return
    await navigator.clipboard.writeText(code)
    toast.success('Davet kodu kopyalandı.')
  }

  return (
    <Modal title={`${server?.name ?? 'Sunucuya'} arkadaş davet et`} subtitle="Kodu arkadaşına gönder; Sunucu > Katıl bölümüne yazsın." onClose={onClose}>
      <div className="space-y-4">
        <Field label="Geçerlilik süresi">
          <Choice options={EXPIRY.map((e) => ({ label: e.label, value: e.hours }))} value={expiry} onChange={setExpiry} />
        </Field>
        <Field label="Kullanım sınırı">
          <Choice options={USES} value={uses} onChange={setUses} />
        </Field>
        {code ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-input p-2 pl-4">
            <span className="selectable flex-1 font-mono text-lg font-bold tracking-widest text-fg">{code}</span>
            <Button onClick={() => void copy()}>
              <Copy className="size-4" /> Kopyala
            </Button>
          </div>
        ) : (
          <Button className="w-full" loading={busy} onClick={() => void create()}>
            Davet kodu oluştur
          </Button>
        )}
      </div>
    </Modal>
  )
}

function Choice<T>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            o.value === value ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
