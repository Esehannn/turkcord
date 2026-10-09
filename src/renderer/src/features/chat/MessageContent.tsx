import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { isEmojiOnly, parseMessage, type Token } from '@/lib/markdown'
import { useProfiles } from '@/data/queries'
import { useUi } from '@/stores/ui'

// Mesaj metnini güvenli React öğelerine çevirir (HTML kullanılmaz).
export function MessageContent({ content, me }: { content: string; me?: string }) {
  const tokens = useMemo(() => parseMessage(content), [content])
  const jumbo = useMemo(() => isEmojiOnly(content), [content])
  return (
    <div className={`selectable break-words whitespace-pre-wrap ${jumbo ? 'text-4xl leading-tight' : 'text-[length:var(--tc-chat-font)] leading-relaxed'} text-fg`}>
      {render(tokens, me)}
    </div>
  )
}

function render(tokens: Token[], me?: string): ReactNode {
  return tokens.map((token, i) => <Fragment key={i}>{renderToken(token, me)}</Fragment>)
}

function renderToken(token: Token, me?: string): ReactNode {
  switch (token.t) {
    case 'text':
      return token.v
    case 'br':
      return <br />
    case 'code':
      return <code className="rounded bg-input px-1 py-0.5 font-mono text-[13px]">{token.v}</code>
    case 'codeblock':
      return (
        <pre className="my-1 overflow-x-auto rounded-md border border-line bg-input p-3 font-mono text-[13px] whitespace-pre scroll-thin">
          {token.v}
        </pre>
      )
    case 'link':
      return (
        <a href={token.v} target="_blank" rel="noreferrer noopener" className="text-[#1971c2] hover:underline dark:text-[#4dabf7]">
          {token.v}
        </a>
      )
    case 'mention':
      return <Mention username={token.v} isMe={token.v === me} />
    case 'bold':
      return <strong className="font-bold">{render(token.c, me)}</strong>
    case 'italic':
      return <em>{render(token.c, me)}</em>
    case 'strike':
      return <s>{render(token.c, me)}</s>
    case 'spoiler':
      return <Spoiler>{render(token.c, me)}</Spoiler>
  }
}

function Mention({ username, isMe }: { username: string; isMe: boolean }) {
  const { data: profiles } = useProfiles()
  const openModal = useUi((s) => s.openModal)
  const profile = useMemo(() => [...(profiles?.values() ?? [])].find((p) => p.username === username), [profiles, username])
  if (!profile) return <>@{username}</>
  return (
    <button
      type="button"
      onClick={() => openModal({ kind: 'profile', userId: profile.id })}
      className={`rounded px-0.5 font-medium ${isMe ? 'bg-accent/20 text-accent' : 'bg-accent-soft text-accent hover:bg-accent hover:text-white'}`}
    >
      @{profile.display_name}
    </button>
  )
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      role="button"
      tabIndex={0}
      className="spoiler px-0.5"
      data-revealed={revealed}
      title={revealed ? undefined : 'Görmek için tıkla'}
      onClick={() => setRevealed(true)}
      onKeyDown={(e) => e.key === 'Enter' && setRevealed(true)}
    >
      {children}
    </span>
  )
}
