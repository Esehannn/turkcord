import { useUi } from '@/stores/ui'

// Sesli sohbet efektleri: ses dosyası yok, kısa tonlar anında üretilir.

let ctx: AudioContext | null = null

function tones(freqs: number[], step = 0.09, length = 0.16, volume = 0.1): void {
  if (!useUi.getState().sounds) return
  try {
    ctx ??= new AudioContext()
    const now = ctx.currentTime
    freqs.forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * step
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(start)
      osc.stop(start + length + 0.02)
    })
  } catch {
    // Ses çalınamazsa önemli değil.
  }
}

export const voiceSounds = {
  join: () => tones([660, 880]), // ben ya da biri kanala girdi
  leave: () => tones([880, 520]), // biri çıktı
  mute: () => tones([520], 0, 0.1, 0.07),
  unmute: () => tones([780], 0, 0.1, 0.07),
  pttOn: () => tones([700], 0, 0.06, 0.035),
  pttOff: () => tones([500], 0, 0.06, 0.03),
}
