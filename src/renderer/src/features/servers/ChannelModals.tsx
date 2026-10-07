import { useState, type FormEvent } from 'react'
import { Hash, Volume2 } from 'lucide-react'
import { confirmDialog, Modal } from '@/components/Modal'
import { Button, Field, Input } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useChannel } from '@/data/queries'
import { normalizeChannelName } from '@/lib/format'

export function CreateChannelModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [kind, setKind] = useState<'text' | 'voice'>('text')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const actions = useActions()
  const finalName = kind === 'text' ? normalizeChannelName(name) : name.trim().slice(0, 32)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!finalName) return
    setBusy(true)
    try {
      await actions.createChannel(serverId, finalName, kind)
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <Modal title="Kanal oluştur" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          {(
            [
              { value: 'text', icon: Hash, label: 'Yazı kanalı', hint: 'Mesaj, görsel, emoji ve sohbet' },
              { value: 'voice', icon: Volume2, label: 'Ses kanalı', hint: 'Sesli sohbet (bir sonraki aşamada aktif)' },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setKind(o.value)}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                kind === o.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'
              }`}
            >
              <o.icon className="size-6 text-muted" />
              <span>
                <span className="block text-sm font-semibold text-fg">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <Field label="Kanal adı" hint={kind === 'text' && name ? `#${finalName}` : undefined}>
          <Input autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'text' ? 'yeni-kanal' : 'Oyun Odası'} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" loading={busy} disabled={!finalName}>
            Oluştur
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function ChannelSettingsModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { data: channel } = useChannel(channelId)
  if (!channel?.server_id) return null
  return <ChannelSettingsForm key={channel.id} channel={{ ...channel, server_id: channel.server_id }} onClose={onClose} />
}

function ChannelSettingsForm({
  channel,
  onClose,
}: {
  channel: { id: string; server_id: string; name: string | null; topic: string | null; kind: string }
  onClose: () => void
}) {
  const [name, setName] = useState(channel.name ?? '')
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [busy, setBusy] = useState(false)
  const actions = useActions()
  const finalName = channel.kind === 'text' ? normalizeChannelName(name) : name.trim().slice(0, 32)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!finalName) return
    setBusy(true)
    try {
      await actions.updateChannel(channel.server_id, channel.id, finalName, topic.trim() || null)
      onClose()
    } catch {
      setBusy(false)
    }
  }

  async function remove() {
    if (
      await confirmDialog({
        title: 'Kanalı sil',
        text: `#${channel.name} kanalı ve içindeki tüm mesajlar kalıcı olarak silinecek.`,
        confirmLabel: 'Sil',
      })
    ) {
      await actions.deleteChannel(channel.server_id, channel.id)
      onClose()
    }
  }

  return (
    <Modal title="Kanal ayarları" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Kanal adı">
          <Input maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {channel.kind === 'text' && (
          <Field label="Konu" hint="Kanal başlığında görünür (isteğe bağlı)">
            <Input maxLength={200} value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-between gap-2">
          <Button variant="danger" onClick={() => void remove()}>
            Kanalı sil
          </Button>
          <Button type="submit" loading={busy} disabled={!finalName}>
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  )
}
