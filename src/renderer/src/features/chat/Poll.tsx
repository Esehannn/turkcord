import { useMemo, useState, type FormEvent } from 'react'
import { BarChart3, Check, Plus, X } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Button, Field, IconButton, Input } from '@/components/ui'
import { useActions } from '@/data/actions'
import type { ChatMessage } from '@/data/queries'
import { tallyVotes } from '@/lib/search'

const MIN_OPTIONS = 2
const MAX_OPTIONS = 6

// Sohbetteki anket: seçeneğe tıklayınca oy verilir, aynı seçeneğe tekrar tıklayınca oy geri alınır.
export function PollMessage({ message, me, canVote, profileName }: { message: ChatMessage; me: string; canVote: boolean; profileName: (id: string) => string }) {
  const actions = useActions()
  const options = message.poll?.options ?? []
  const tally = useMemo(() => tallyVotes(options.length, message.votes), [options.length, message.votes])
  const mine = message.votes.find((v) => v.user_id === me)?.option ?? null

  return (
    <div className="mt-1 max-w-md rounded-lg border border-line bg-sidebar p-3">
      <p className="flex items-start gap-2 font-semibold text-fg">
        <BarChart3 className="mt-0.5 size-4 shrink-0 text-accent" />
        <span className="selectable break-words">{message.content}</span>
      </p>
      <div className="mt-2.5 space-y-1.5">
        {options.map((option, i) => {
          const chosen = mine === i
          return (
            <button
              key={i}
              type="button"
              disabled={!canVote}
              title={
                message.votes
                  .filter((v) => v.option === i)
                  .map((v) => profileName(v.user_id))
                  .join(', ') || undefined
              }
              onClick={() => void actions.votePoll(message.id, me, chosen ? null : i, mine).catch(() => undefined)}
              className={`relative block w-full overflow-hidden rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
                chosen ? 'border-accent text-fg' : 'border-line text-fg hover:border-faint'
              } disabled:cursor-default`}
            >
              <span
                className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${chosen ? 'bg-accent-soft' : 'bg-hover'}`}
                style={{ width: `${tally.percents[i]}%` }}
              />
              <span className="relative flex items-center gap-2">
                {chosen && <Check className="size-3.5 shrink-0 text-accent" />}
                <span className="min-w-0 flex-1 break-words">{option}</span>
                <span className="shrink-0 text-xs font-semibold text-muted tabular-nums">
                  {tally.counts[i]} · %{tally.percents[i]}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-faint">{tally.total === 0 ? 'Henüz oy yok' : `${tally.total} oy`}</p>
    </div>
  )
}

export function CreatePollModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const actions = useActions()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [busy, setBusy] = useState(false)

  const filled = options.map((o) => o.trim()).filter(Boolean)
  const valid = question.trim().length > 0 && filled.length >= MIN_OPTIONS

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      await actions.createPoll(channelId, question.trim(), filled)
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <Modal title="Anket oluştur" subtitle="Herkes tek oy verir; oyunu sonradan değiştirebilir." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Soru">
          <Input autoFocus value={question} maxLength={300} placeholder="Bu akşam ne oynuyoruz?" onChange={(e) => setQuestion(e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">Seçenekler</span>
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={option}
                maxLength={80}
                placeholder={`${i + 1}. seçenek`}
                onChange={(e) => setOptions((list) => list.map((o, j) => (j === i ? e.target.value : o)))}
              />
              {options.length > MIN_OPTIONS && (
                <IconButton label="Seçeneği kaldır" onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <Button variant="ghost" className="px-2" onClick={() => setOptions((list) => [...list, ''])}>
              <Plus className="size-4" /> Seçenek ekle
            </Button>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" loading={busy} disabled={!valid}>
            Anketi gönder
          </Button>
        </div>
      </form>
    </Modal>
  )
}
