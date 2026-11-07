import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { setStreamVolume, useVoice } from '@/voice/store'

// İzlenen yayının (ekran paylaşımındaki bilgisayar sesinin) seviyesi. Kişinin konuşma sesinden ayrıdır ve bu
// bilgisayarda saklanır. Simgeye basınca sessize alınır / eski seviyeye döner.
export function useStreamVolume(userId: string): number {
  return useVoice((s) => s.streamVolumes[userId] ?? 1)
}

const lastHeard = new Map<string, number>()

export function StreamVolume({ userId, dark = true }: { userId: string; dark?: boolean }) {
  const volume = useStreamVolume(userId)
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const toggle = () => {
    if (volume > 0) {
      lastHeard.set(userId, volume)
      setStreamVolume(userId, 0)
    } else {
      setStreamVolume(userId, lastHeard.get(userId) ?? 1)
    }
  }
  return (
    <div
      className={`flex h-8 items-center gap-1.5 rounded-md px-1.5 ${dark ? 'bg-black/55 text-white' : 'bg-input text-fg'}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button type="button" aria-label={volume === 0 ? 'Yayının sesini aç' : 'Yayının sesini kapat'} data-tip="Yayın sesi" onClick={toggle} className="grid size-6 place-items-center">
        <Icon className="size-4" />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        aria-label="Yayın sesi"
        onChange={(e) => setStreamVolume(userId, Number(e.target.value) / 100)}
        className="w-20 accent-accent"
      />
    </div>
  )
}
