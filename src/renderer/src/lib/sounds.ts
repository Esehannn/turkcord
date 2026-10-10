import { useUi } from '@/stores/ui'

// Uygulamanın bütün sesleri burada üretilir: bildirimler, arama melodisi, ses kanalı işaretleri ve ses efektleri.
// Ses dosyası yoktur; tonlar anında sentezlenir (kurulum küçük kalır, telif sorunu olmaz).
//
// Ses teması mehterdir: bildirimler ve arama melodisi "Ceddin Deden"in notalarından (Mi karar) kurulur ve
// hepsi aynı yumuşak, tahta vuruşlu "mallet" tınısıyla çalınır.

type Tone = {
  // Başlangıç ve süre (saniye), frekans (Hz). `to` verilirse frekans oraya kayar.
  t: number
  d: number
  f: number
  to?: number
  type?: OscillatorType
  g?: number
  // pluck: vurmalı nota; anında açılır ve süre boyunca sönerek biter.
  env?: 'pluck'
}
type Noise = { t: number; d: number; g?: number; hp?: number; lp?: number }
// cutoff: bu frekansın üstü kısılır (Hz); sesi yumuşatır, kulak tırmalayan tizleri alır.
type Score = { tones?: Tone[]; noises?: Noise[]; length: number; cutoff?: number }

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
  // Çıkış zinciri: tiz kesici (yumuşaklık) → sınırlayıcı (üst üste binen sesler patlamasın) → hoparlör.
  const soften = ac.createBiquadFilter()
  soften.type = 'lowpass'
  soften.frequency.value = score.cutoff ?? 7000
  soften.Q.value = 0.5
  const limiter = ac.createDynamicsCompressor()
  limiter.threshold.value = -18
  limiter.knee.value = 12
  limiter.ratio.value = 8
  limiter.attack.value = 0.003
  limiter.release.value = 0.15
  master.connect(soften).connect(limiter).connect(ac.destination)

  for (const tone of score.tones ?? []) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = tone.type ?? 'sine'
    const t0 = start + tone.t
    osc.frequency.setValueAtTime(tone.f, t0)
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t0 + tone.d)
    const peak = tone.g ?? 0.3
    gain.gain.setValueAtTime(0.0001, t0)
    if (tone.env === 'pluck') {
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.006)
    } else {
      gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.03, tone.d / 4))
      gain.gain.setValueAtTime(peak, t0 + tone.d * 0.6)
    }
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

  const release = () => {
    master.disconnect()
    soften.disconnect()
    limiter.disconnect()
  }
  const cleanup = setTimeout(release, (start - ac.currentTime + score.length + 0.5) * 1000)
  return () => {
    clearTimeout(cleanup)
    try {
      master.gain.cancelScheduledValues(ac.currentTime)
      master.gain.setTargetAtTime(0, ac.currentTime, 0.02)
      setTimeout(release, 200)
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

// "Ceddin Deden"in notaları (Mi karar).
const D4 = 293.66
const E4 = 329.63
const FS4 = 369.99
const G4 = 392.0
const A4 = 440.0
const B4 = 493.88
const C5 = 523.25
const D5 = 587.33
const E5 = 659.25

// Mallet: yuvarlak, tahta vuruşlu, sönen nota (marimba ile kalimba arası). Temel ses sinüstür; üstüne az
// miktarda üçgen (gövde), bir oktav üstü (parlaklık) ve çok kısa bir vuruş sesi biner.
function mallet(t: number, f: number, d: number, g = 0.24): Tone[] {
  const ring = Math.max(0.32, d)
  return [
    { t, d: ring, f, type: 'sine', g, env: 'pluck' },
    { t, d: ring * 0.55, f, type: 'triangle', g: g * 0.22, env: 'pluck' },
    { t, d: ring * 0.5, f: f * 2, type: 'sine', g: g * 0.16, env: 'pluck' },
    { t, d: 0.07, f: f * 4, type: 'sine', g: g * 0.07, env: 'pluck' },
  ]
}

// Birkaç notalık kısa ezgi.
function motif(notes: [at: number, freq: number, len?: number][], gain: number, cutoff = 5200): Score {
  const tones: Tone[] = []
  let length = 0
  for (const [t, f, d = 0.3] of notes) {
    tones.push(...mallet(t, f, d, gain))
    length = Math.max(length, t + Math.max(0.32, d))
  }
  return { tones, length, cutoff }
}

const NOTIFY = {
  // Özel mesaj: marşın karara bağlanışı (Re → Mi).
  message: motif(
    [
      [0, D5, 0.16],
      [0.1, E5, 0.42],
    ],
    0.26,
  ),
  // Etiketlenme: La-La → Mi sıçrayışı, çağrı gibi.
  mention: motif(
    [
      [0, A4, 0.14],
      [0.11, A4, 0.14],
      [0.22, E5, 0.5],
    ],
    0.28,
  ),
  // Arkadaşlık isteği: Sol → Si.
  friend: motif(
    [
      [0, G4, 0.2],
      [0.15, B4, 0.45],
    ],
    0.24,
  ),
  // Sunucu kanalındaki sıradan mesaj (isteğe bağlı): tek Mi.
  channel: motif([[0, E5, 0.28]], 0.2),
  // Bir arkadaş ses kanalına girdi: Mi → La → Si.
  voice: motif(
    [
      [0, E4, 0.16],
      [0.12, A4, 0.16],
      [0.24, B4, 0.45],
    ],
    0.24,
  ),
  // Arama bitti / reddedildi: marşın kapanışı (Fa♯ · Re · Mi).
  hangup: motif(
    [
      [0, FS4, 0.22],
      [0.17, D4, 0.16],
      [0.3, E4, 0.6],
    ],
    0.26,
  ),
} satisfies Record<string, Score>

// Ses kanalı işaretleri: giriş (Mi → Si), çıkış (Si → Mi), mikrofon kapat / aç (pes / tiz tek vuruş), bas-konuş.
const VOICE_CUES = {
  join: motif(
    [
      [0, E4, 0.14],
      [0.1, B4, 0.36],
    ],
    0.2,
  ),
  leave: motif(
    [
      [0, B4, 0.14],
      [0.1, E4, 0.36],
    ],
    0.2,
  ),
  mute: motif([[0, G4, 0.16]], 0.14, 3200),
  unmute: motif([[0, B4, 0.16]], 0.14, 3200),
  pttOn: motif([[0, B4, 0.1]], 0.06, 3200),
  pttOff: motif([[0, G4, 0.1]], 0.05, 3200),
} satisfies Record<string, Score>

export type VoiceCue = keyof typeof VOICE_CUES

export function playVoiceCue(name: VoiceCue): void {
  const v = volume()
  if (v <= 0) return
  try {
    schedule(VOICE_CUES[name], v)
  } catch {
    // Ses çalınamazsa önemli değil.
  }
}

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

// Mehter: "Ceddin Deden"in 5-9. ölçüleri (kayıttan çıkarılan notalar), mallet tınısıyla; altında yumuşak bir bas
// ve mehter usulünde davul (düm · tek-tek · düm · tek). Tempo BEAT ile ayarlanır.
const BEAT = 0.52
const SIXTEENTH = BEAT / 4
// Her ölçü: [başlangıç (onaltılık), süre (onaltılık), nota]
type Bar = [at: number, len: number, freq: number][]
const DESCENT: Bar = [
  [0, 3, A4],
  [3, 1, G4],
  [4, 3, B4],
  [7, 1, A4],
  [8, 3, G4],
  [11, 1, FS4],
  [12, 3, E4],
  [15, 1, FS4],
]
const CADENCE: Bar = [
  [0, 3, G4],
  [3, 1, A4],
  [4, 3, FS4],
  [7, 1, D4],
  [8, 8, E4],
]
const MEHTER: Bar[] = [
  [
    [0, 5, E5],
    [5, 2, C5],
    [7, 1, B4],
    [8, 8, A4],
  ],
  DESCENT,
  CADENCE,
  [[0, 3, A4], [3, 1, B4], ...DESCENT.slice(2)],
  CADENCE,
]
// Ölçü başına iki bas notası (La, Mi, Sol).
const MEHTER_BASS = [
  [110, 110],
  [110, 164.81],
  [98, 164.81],
  [110, 164.81],
  [98, 164.81],
]

function mehterScore(): Score {
  const tones: Tone[] = []
  const noises: Noise[] = []
  MEHTER.forEach((bar, i) => {
    const t0 = i * 16 * SIXTEENTH
    for (const [at, len, f] of bar) tones.push(...mallet(t0 + at * SIXTEENTH, f, len * SIXTEENTH * 1.25, len <= 1 ? 0.19 : 0.25))
    MEHTER_BASS[i].forEach((f, half) => {
      const t = t0 + half * 8 * SIXTEENTH
      tones.push({ t, d: BEAT * 1.9, f, type: 'sine', g: 0.2, env: 'pluck' }, { t, d: BEAT * 1.2, f: f * 2, type: 'triangle', g: 0.05, env: 'pluck' })
    })
    // Davul: güçlü vuruşta "düm" (pes), aralarda "tek" (kısa, kısık).
    for (const beat of [0, 2]) {
      const t = t0 + beat * BEAT
      tones.push({ t, d: 0.22, f: 105, to: 52, type: 'sine', g: 0.3 })
      noises.push({ t, d: 0.05, g: 0.05, lp: 500 })
    }
    for (const beat of [1, 1.5, 3]) noises.push({ t: t0 + beat * BEAT, d: 0.045, g: 0.028, hp: 1400, lp: 3600 })
  })
  return { tones, noises, length: MEHTER.length * 16 * SIXTEENTH, cutoff: 5200 }
}

const KLASIK: Score = {
  tones: [0, 0.5].flatMap((t) => [
    { t, d: 0.4, f: 440, type: 'sine' as const, g: 0.22 },
    { t, d: 0.4, f: 480, type: 'sine' as const, g: 0.22 },
    { t: t + 0.2, d: 0.2, f: 880, type: 'triangle' as const, g: 0.08 },
  ]),
  length: 1,
}

// Arayan tarafın duyduğu "çalıyor" tonu: mehterin "dem" sesi gibi alçak, Mi-Si açık beşli.
const RINGBACK: Score = {
  tones: [
    { t: 0, d: 1.1, f: E4, type: 'sine', g: 0.1 },
    { t: 0, d: 1.1, f: B4 / 2, type: 'sine', g: 0.08 },
    { t: 0, d: 1.1, f: E4 / 2, type: 'triangle', g: 0.04 },
  ],
  length: 1.1,
  cutoff: 3000,
}

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
  return loop(choice === 'klasik' ? KLASIK : mehterScore(), choice === 'klasik' ? 1.6 : 0.8, volume)
}

export function startRingback(): () => void {
  return loop(RINGBACK, 2.2, () => volume() * 0.8)
}

// ---------------------------------------------------------------------------
// Ses efektleri (ses kanalında herkese çalınır)
// ---------------------------------------------------------------------------

// Efektler bilerek yumuşak tutulur: ağırlıklı olarak üçgen ve sinüs dalga, az miktarda testere (karakter için),
// 3-4 kHz üstü kesik. Ses kanalında konuşmanın üstüne bindiği için bildirimlerden de kısık çalar.
const brass = (t: number, d: number, f: number, g: number): Tone[] => [
  { t, d, f, type: 'triangle', g },
  { t, d, f: f * 1.004, type: 'sawtooth', g: g * 0.22 },
]

const fanfare = (base: number): Tone[] =>
  [0, 0.14, 0.28, 0.42].flatMap((t, i) => brass(t, i === 3 ? 0.5 : 0.13, base * [1, 1.26, 1.5, 2][i], 0.16))

const EFFECT_SCORES = {
  korna: {
    tones: [233, 277, 349].flatMap((f) => brass(0, 0.8, f, 0.11)),
    length: 0.8,
    cutoff: 2600,
  },
  alkis: {
    noises: Array.from({ length: 22 }, (_, i) => ({ t: i * 0.085 + (i % 3) * 0.012, d: 0.06, g: 0.1 + (i % 4) * 0.015, hp: 700, lp: 3200 })),
    length: 2,
    cutoff: 3600,
  },
  davul: {
    tones: [
      { t: 0, d: 0.16, f: 180, to: 110, type: 'sine' as const, g: 0.4 },
      { t: 0.2, d: 0.22, f: 130, to: 70, type: 'sine' as const, g: 0.45 },
    ],
    noises: [
      { t: 0, d: 0.08, g: 0.1, lp: 1500 },
      { t: 0.2, d: 0.09, g: 0.1, lp: 1000 },
      { t: 0.48, d: 0.6, g: 0.07, hp: 3000 },
    ],
    length: 1.2,
    cutoff: 5200,
  },
  huzun: {
    tones: (
      [
        [0, 311, 0.34],
        [0.36, 294, 0.34],
        [0.72, 277, 0.34],
        [1.08, 262, 0.9],
      ] as const
    ).flatMap(([t, f, d]) => [
      { t, d, f, to: f * 0.97, type: 'triangle' as const, g: 0.2 },
      { t, d, f: f / 2, type: 'sine' as const, g: 0.14 },
    ]),
    length: 2,
    cutoff: 2400,
  },
  zafer: { tones: fanfare(392), length: 1, cutoff: 3000 },
  lazer: {
    tones: [0, 0.16, 0.32].map((t) => ({ t, d: 0.14, f: 1200, to: 220, type: 'triangle' as const, g: 0.16 })),
    length: 0.5,
    cutoff: 3000,
  },
  hata: {
    tones: [
      { t: 0, d: 0.22, f: 196, type: 'triangle' as const, g: 0.22 },
      { t: 0.24, d: 0.36, f: 147, type: 'triangle' as const, g: 0.22 },
      { t: 0.24, d: 0.36, f: 73.5, type: 'sine' as const, g: 0.16 },
    ],
    length: 0.6,
    cutoff: 2000,
  },
  ding: {
    tones: [
      { t: 0, d: 1.1, f: 1047, type: 'sine' as const, g: 0.24 },
      { t: 0, d: 0.7, f: 2093, type: 'sine' as const, g: 0.05 },
      { t: 0, d: 0.9, f: 1568, type: 'sine' as const, g: 0.05 },
    ],
    length: 1.1,
    cutoff: 5000,
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
    schedule(EFFECT_SCORES[id], v * 0.6)
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
