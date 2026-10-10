import { playVoiceCue } from '@/lib/sounds'

// Sesli sohbet işaretleri: uygulamanın ortak ses temasıyla (lib/sounds.ts) çalınır.
export const voiceSounds = {
  join: () => playVoiceCue('join'), // ben ya da biri kanala girdi
  leave: () => playVoiceCue('leave'), // biri çıktı
  mute: () => playVoiceCue('mute'),
  unmute: () => playVoiceCue('unmute'),
  pttOn: () => playVoiceCue('pttOn'),
  pttOff: () => playVoiceCue('pttOff'),
}
