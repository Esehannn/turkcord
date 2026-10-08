import { useUi } from '@/stores/ui'

// Uygulamanın bütün sesleri burada üretilir: bildirimler, arama melodisi ve ses efektleri.
// Ses dosyası yoktur; tonlar anında sentezlenir (kurulum küçük kalır, telif sorunu olmaz).

type Tone = {
  // Başlangıç ve süre (saniye), frekans (Hz). `to` verilirse frekans oraya kayar.
  t: number
  d: number
  f: number
  to?: number
  type?: OscillatorType
  g?: number
}
type Noise = { t: number; d: number; g?: number; hp?: number; lp?: number }
type Score = { tones?: Tone[]; noises?: Noise[]; length: number }

let ctx: AudioContext | null = null
let noiseBuffer: AudioBuffer | null = null

function audio(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function noise(ac: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

// Bir "nota kâğıdını" çalar. Dönen fonksiyon sesi hemen keser.
function schedule(score: Score, volume: number, at?: number): () => void {
  const ac = audio()
  const start = at ?? ac.currentTime + 0.02
  const master = ac.createGain()
  master.gain.value = Math.min(1, Math.max(0, volume))
  master.connect(ac.destination)

  for (const tone of score.tones ?? []) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = tone.type ?? 'sine'
    const t0 = start + tone.t
    osc.frequency.setValueAtTime(tone.f, t0)
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t0 + tone.d)
    const peak = tone.g ?? 0.3
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.015, tone.d / 4))
    gain.gain.setValueAtTime(peak, t0 + tone.d * 0.6)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.d)
    osc.connect(gain).connect(master)
    osc.start(t0)
    osc.stop(t0 + tone.d + 0.03)
  }

  for (const n of score.noises ?? []) {
    const source = ac.createBufferSource()
    source.buffer = noise(ac)
    source.loop = true
    const gain = ac.createGain()
    const t0 = start + n.t
    const peak = n.g ?? 0.3
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d)
    let node: AudioNode = source
    if (n.hp) {
      const hp = ac.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = n.hp
      node.connect(hp)
      node = hp
    }
    if (n.lp) {
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = n.lp
      node.connect(lp)
      node = lp
    }
    node.connect(gain).connect(master)
    source.start(t0)
    source.stop(t0 + n.d + 0.03)
  }

  const cleanup = setTimeout(() => master.disconnect(), (start - ac.currentTime + score.length + 0.5) * 1000)
  return () => {
    clearTimeout(cleanup)
    try {
      master.gain.cancelScheduledValues(ac.currentTime)
      master.gain.setTargetAtTime(0, ac.currentTime, 0.02)
      setTimeout(() => master.disconnect(), 200)
    } catch {
      // Zaten kapanmış.
    }
  }
}

function volume(): number {
  const { sounds, volume: v } = useUi.getState()
  return sounds ? v : 0
}

// ---------------------------------------------------------------------------
// Bildirim sesleri
// ---------------------------------------------------------------------------

// Aynı notayı üçgen + sinüsle çalar: tek sinüse göre daha dolgun ve duyulur.
function chime(notes: [at: number, freq: number, len?: number][], gain = 0.34): Score {
  const tones: Tone[] = []
  let length = 0
  for (const [t, f, d = 0.22] of notes) {
    tones.push({ t, d, f, type: 'triangle', g: gain }, { t, d: d * 1.4, f: f * 2, type: 'sine', g: gain * 0.35 })
    length = Math.max(length, t + d * 1.4)
  }
  return { tones, length }
}

const NOTIFY = {
  // Özel mesaj: iki notalık yükselen "dı-dın".
  message: chime([
    [0, 784],
    [0.11, 1175, 0.3],
  ]),
  // Etiketlenme: üç notalı, daha ısrarcı.
  mention: chime(
    [
      [0, 880, 0.16],
      [0.12, 1109, 0.16],
      [0.24, 1319, 0.36],
    ],
    0.38,
  ),
  // Arkadaşlık isteği: yumuşak iki nota.
  friend: chime([
    [0, 659, 0.2],
    [0.16, 988, 0.34],
  ]),
  // Sunucu kanalındaki sıradan mesaj (isteğe bağlı): tek, kısa nota.
  channel: chime([[0, 932, 0.16]], 0.22),
  // Arama bitti / reddedildi.
  hangup: chime(
    [
      [0, 587, 0.16],
      [0.15, 440, 0.16],
      [0.3, 330, 0.3],
    ],
    0.26,
  ),
} satisfies Record<string, Score>

export type NotifySound = keyof typeof NOTIFY

export function playSound(name: NotifySound): void {
  const v = volume()
  if (v <= 0) return
  try {
    schedule(NOTIFY[name], v)
  } catch {
    // Ses çalınamazsa sessizce geç.
  }
}

// ---------------------------------------------------------------------------
// Arama melodisi
// ---------------------------------------------------------------------------

export type Ringtone = 'mehter' | 'klasik' | 'ozel'
export const RINGTONES: { value: Ringtone; label: string }[] = [
  { value: 'mehter', label: 'Mehter' },
  { value: 'klasik', label: 'Klasik zil' },
  { value: 'ozel', label: 'Kendi dosyam' },
]

const CUSTOM_KEY = 'turkcord-zil-dosyasi'
export const MAX_RINGTONE_BYTES = 1.5 * 1024 * 1024

export function customRingtone(): string | null {
  try {
    return localStorage.getItem(CUSTOM_KEY)
  } catch {
    return null
  }
}

export async function saveCustomRingtone(file: File): Promise<void> {
  if (!file.type.startsWith('audio/')) throw new Error('Bir ses dosyası seç (mp3, ogg, wav).')
  if (file.size > MAX_RINGTONE_BYTES) throw new Error('Melodi dosyası en fazla 1,5 MB olabilir.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Dosya okunamadı.'))
    reader.readAsDataURL(file)
  })
  try {
    localStorage.setItem(CUSTOM_KEY, dataUrl)
  } catch {
    throw new Error('Melodi kaydedilemedi (dosya çok büyük olabilir).')
  }
}

export function clearCustomRingtone(): void {
  try {
    localStorage.removeItem(CUSTOM_KEY)
  } catch {
    // önemli değil
  }
}

// Mehter havası: "Ceddin Deden"in açılış ezgisi, yumuşak bir sentez sesiyle; altında davul (düm-tek).
// Ezgi kulaktan yazıldı; notalar MEHTER dizisinde, tempo BEAT ile ayarlanır.
const BEAT = 0.42
const E4 = 329.63
const F4 = 349.23
const G4 = 392.0
const D4 = 293.66
const C4 = 261.63
const MEHTER: number[][] = [
  [E4, E4, D4, E4],
  [F4, F4, E4, D4],
  [G4, G4, F4, E4],
  [F4, E4, D4, C4],
]

function mehterScore(): Score {
  const tones: Tone[] = []
  const noises: Noise[] = []
  let beat = 0
  for (const phrase of MEHTER) {
    phrase.forEach((f, i) => {
      const t = beat * BEAT
      const d = i === 3 ? BEAT * 0.95 : BEAT * 0.8
      // Zurna yerine yumuşak, hafif genizden bir ses: kare + üçgen, bir oktav üstü ince.
      tones.push({ t, d, f: f * 2, type: 'square', g: 0.075 }, { t, d, f: f * 2, type: 'triangle', g: 0.2 }, { t, d, f: f * 4, type: 'sine', g: 0.04 })
      // Davul: güçlü vuruşta "düm" (pes), zayıf vuruşta "tek" (tiz).
      if (i % 2 === 0) {
        tones.push({ t, d: 0.2, f: 110, to: 55, type: 'sine', g: 0.5 })
        noises.push({ t, d: 0.06, g: 0.12, lp: 600 })
      } else {
        noises.push({ t, d: 0.05, g: 0.1, hp: 2500 })
      }
      beat++
    })
  }
  return { tones, noises, length: beat * BEAT }
}

const KLASIK: Score = {
  tones: [0, 0.5].flatMap((t) => [
    { t, d: 0.4, f: 440, type: 'sine' as const, g: 0.22 },
    { t, d: 0.4, f: 480, type: 'sine' as const, g: 0.22 },
    { t: t + 0.2, d: 0.2, f: 880, type: 'triangle' as const, g: 0.08 },
  ]),
  length: 1,
}

// Arayan tarafın duyduğu "çalıyor" tonu.
const RINGBACK: Score = { tones: [{ t: 0, d: 1.0, f: 450, type: 'sine', g: 0.12 }], length: 1.0 }

function loop(score: Score, gapSeconds: number, level: () => number): () => void {
  let stopCurrent: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const tick = () => {
    if (stopped) return
    const v = level()
    if (v > 0) {
      try {
        stopCurrent = schedule(score, v)
      } catch {
        // Ses çalınamazsa görsel bildirim yeter.
      }
    }
    timer = setTimeout(tick, (score.length + gapSeconds) * 1000)
  }
  tick()
  return () => {
    stopped = true
    clearTimeout(timer)
    stopCurrent?.()
  }
}

// Gelen arama melodisini döngüde çalar. Dönen fonksiyon susturur.
export function startRingtone(choice: Ringtone = useUi.getState().ringtone): () => void {
  const custom = choice === 'ozel' ? customRingtone() : null
  if (custom) {
    const v = volume()
    if (v <= 0) return () => {}
    const el = new Audio(custom)
    el.loop = true
    el.volume = v
    void el.play().catch(() => {})
    return () => {
      el.pause()
      el.src = ''
    }
  }
  return loop(choice === 'klasik' ? KLASIK : mehterScore(), choice === 'klasik' ? 1.6 : 0.7, volume)
}

export function startRingback(): () => void {
  return loop(RINGBACK, 2.2, () => volume() * 0.8)
}

// ---------------------------------------------------------------------------
// Ses efektleri (ses kanalında herkese çalınır)
// ---------------------------------------------------------------------------

const fanfare = (base: number): Tone[] =>
  [0, 0.14, 0.28, 0.42].flatMap((t, i) => {
    const f = base * [1, 1.26, 1.5, 2][i]
    const d = i === 3 ? 0.5 : 0.13
    return [
      { t, d, f, type: 'sawtooth' as const, g: 0.14 },
      { t, d, f: f * 1.005, type: 'square' as const, g: 0.07 },
    ]
  })

const EFFECT_SCORES = {
  korna: {
    tones: [233, 277, 349, 466].flatMap((f) => [
      { t: 0, d: 0.9, f, type: 'sawtooth' as const, g: 0.11 },
      { t: 0, d: 0.9, f: f * 1.01, type: 'sawtooth' as const, g: 0.08 },
    ]),
    length: 0.9,
  },
  alkis: {
    noises: Array.from({ length: 22 }, (_, i) => ({ t: i * 0.085 + (i % 3) * 0.012, d: 0.06, g: 0.2 + (i % 4) * 0.03, hp: 900, lp: 5000 })),
    length: 2,
  },
  davul: {
    tones: [
      { t: 0, d: 0.16, f: 180, to: 110, type: 'sine' as const, g: 0.5 },
      { t: 0.2, d: 0.22, f: 130, to: 70, type: 'sine' as const, g: 0.55 },
    ],
    noises: [
      { t: 0, d: 0.08, g: 0.2, lp: 1800 },
      { t: 0.2, d: 0.09, g: 0.2, lp: 1200 },
      { t: 0.48, d: 0.7, g: 0.2, hp: 6000 },
    ],
    length: 1.2,
  },
  huzun: {
    tones: [
      [0, 311, 0.34],
      [0.36, 294, 0.34],
      [0.72, 277, 0.34],
      [1.08, 262, 0.9],
    ].flatMap(([t, f, d]) => [
      { t, d, f, to: f * 0.97, type: 'sawtooth' as const, g: 0.16 },
      { t, d, f: f / 2, type: 'triangle' as const, g: 0.14 },
    ]),
    length: 2,
  },
  zafer: { tones: fanfare(392), length: 1 },
  lazer: {
    tones: [0, 0.16, 0.32].map((t) => ({ t, d: 0.14, f: 1800, to: 240, type: 'square' as const, g: 0.14 })),
    length: 0.5,
  },
  hata: {
    tones: [
      { t: 0, d: 0.55, f: 110, type: 'sawtooth' as const, g: 0.2 },
      { t: 0, d: 0.55, f: 116, type: 'square' as const, g: 0.1 },
    ],
    length: 0.6,
  },
  ding: {
    tones: [
      { t: 0, d: 1.1, f: 1568, type: 'sine' as const, g: 0.3 },
      { t: 0, d: 0.7, f: 3136, type: 'sine' as const, g: 0.08 },
      { t: 0, d: 0.9, f: 2093, type: 'triangle' as const, g: 0.06 },
    ],
    length: 1.1,
  },
  mehter: mehterScore(),
} satisfies Record<string, Score>

export type EffectId = keyof typeof EFFECT_SCORES

export const EFFECTS: { id: EffectId; label: string; emoji: string }[] = [
  { id: 'korna', label: 'Korna', emoji: '📯' },
  { id: 'alkis', label: 'Alkış', emoji: '👏' },
  { id: 'davul', label: 'Ba-dum-tıss', emoji: '🥁' },
  { id: 'huzun', label: 'Hüzün', emoji: '🎺' },
  { id: 'zafer', label: 'Zafer', emoji: '🏆' },
  { id: 'lazer', label: 'Lazer', emoji: '🔫' },
  { id: 'hata', label: 'Yanlış!', emoji: '❌' },
  { id: 'ding', label: 'Ding', emoji: '🔔' },
  { id: 'mehter', label: 'Mehter', emoji: '🇹🇷' },
]

export function isEffectId(value: unknown): value is EffectId {
  return typeof value === 'string' && Object.hasOwn(EFFECT_SCORES, value)
}

export function playEffect(id: EffectId): void {
  const { effects, volume: v } = useUi.getState()
  if (!effects || v <= 0) return
  try {
    schedule(EFFECT_SCORES[id], Math.min(1, v * 1.1))
  } catch {
    // önemli değil
  }
}

// Ayarlardaki "dene" düğmeleri için: tercihlere bakmadan çalar.
export function previewSound(name: NotifySound, level: number): void {
  try {
    schedule(NOTIFY[name], level)
  } catch {
    // önemli değil
  }
}
