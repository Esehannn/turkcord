import { useEffect, useState } from 'react'
import { elapsedLabel } from '@/lib/format'
import type { VoiceParticipant } from '@/voice/store'

// Seste geçen süre ("42 dk"). Dakika hassasiyetinde olduğu için yarım dakikada bir yenilenir.
export function Elapsed({ since, className }: { since: number; className?: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  return <span className={className}>{elapsedLabel(Date.now() - since)}</span>
}

// Odanın ne zamandır açık olduğu: içerideki en eski katılımcının giriş anı.
export function roomSince(participants: VoiceParticipant[] | undefined): number | undefined {
  const times = (participants ?? []).map((p) => p.since).filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : undefined
}
