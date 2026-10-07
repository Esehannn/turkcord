import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmBase64 from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?base64'
import { useVoice } from './store'

// Mikrofon hattı: mikrofon → (yapay zekâ gürültü engelleme) → ölçer → ses kapısı → gönderilen ses.
// Ses kapısı, giriş hassasiyetinin altındaki sesi (nefes, uzaktaki konuşma, fan) iletmez.

export const AUTO_GATE_DB = -60
const GATE_HOLD_MS = 300
const TICK_MS = 20

export type Microphone = {
  // Karşı tarafa gönderilen (işlenmiş) ses.
  stream: MediaStream
  // Son ölçülen seviye (dB, -100…0) ve kapı açık mı?
  level: () => { db: number; open: boolean }
  // Sesin iletilip iletilmeyeceği (susturma, bas-konuş).
  setEnabled: (enabled: boolean) => void
  // Yapay zekâ gürültü engelleme gerçekten çalışıyor mu?
  aiActive: boolean
  // Seçilen mikrofon bulunamayıp varsayılana geçildi mi?
  fellBack: boolean
  stop: () => void
}

let wasmBinary: ArrayBuffer | null = null
function rnnoiseBinary(): ArrayBuffer {
  if (!wasmBinary) {
    const bytes = Uint8Array.from(atob(rnnoiseWasmBase64), (c) => c.charCodeAt(0))
    wasmBinary = bytes.buffer
  }
  // Her düğüm kendi kopyasını alır (worklet'e aktarılırken sahipliği geçebilir).
  return wasmBinary.slice(0)
}

function constraints(deviceId: string | null): MediaTrackConstraints {
  const { noiseMode, echoCancellation } = useVoice.getState()
  return {
    deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
    echoCancellation,
    // Yapay zekâ modunda tarayıcınınki kapatılır; ikisi üst üste sesi bozuk yapar.
    noiseSuppression: noiseMode === 'standart',
    autoGainControl: true,
    channelCount: 1,
  }
}

async function capture(): Promise<{ raw: MediaStream; fellBack: boolean }> {
  const { inputDeviceId } = useVoice.getState()
  try {
    return { raw: await navigator.mediaDevices.getUserMedia({ audio: constraints(inputDeviceId), video: false }), fellBack: false }
  } catch (error) {
    const name = (error as { name?: string })?.name
    // Seçilen mikrofon çıkarılmışsa varsayılanla devam et.
    if (inputDeviceId !== 'default' && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
      return { raw: await navigator.mediaDevices.getUserMedia({ audio: constraints(null), video: false }), fellBack: true }
    }
    throw error
  }
}

export function micErrorMessage(error: unknown): string {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Mikrofon izni yok. Windows Ayarları > Gizlilik ve güvenlik > Mikrofon bölümünde "Masaüstü uygulamalarının mikrofona erişmesine izin ver" açık olmalı.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Mikrofon bulunamadı. Takılı olduğundan emin ol.'
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Mikrofon açılamadı. Başka bir uygulama kullanıyor olabilir ya da Windows ses ayarlarında devre dışı olabilir.'
  }
  return 'Mikrofon açılamadı.'
}

export async function openMicrophone(): Promise<Microphone> {
  const { raw, fellBack } = await capture()
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {})

  const source = ctx.createMediaStreamSource(raw)
  let input: AudioNode = source
  let rnnoise: RnnoiseWorkletNode | null = null
  if (useVoice.getState().noiseMode === 'guclu') {
    try {
      await ctx.audioWorklet.addModule(rnnoiseWorkletUrl)
      rnnoise = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: rnnoiseBinary() })
      source.connect(rnnoise)
      input = rnnoise
    } catch (error) {
      console.warn('Yapay zekâ gürültü engelleme açılamadı', error)
    }
  }

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const gate = ctx.createGain()
  const destination = ctx.createMediaStreamDestination()
  input.connect(analyser)
  input.connect(gate)
  gate.connect(destination)

  const data = new Float32Array(analyser.fftSize)
  let db = -100
  let open = false
  let lastLoud = 0
  let enabled = true
  gate.gain.value = 0

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += v * v
    db = Math.max(-100, 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-5))
    const { autoGate, gateDb } = useVoice.getState()
    const threshold = autoGate ? AUTO_GATE_DB : gateDb
    const now = performance.now()
    if (db >= threshold) lastLoud = now
    const next = enabled && now - lastLoud < GATE_HOLD_MS
    if (next !== open) {
      open = next
      // Açılış hızlı (hece kaçmasın), kapanış yumuşak.
      gate.gain.setTargetAtTime(next ? 1 : 0, ctx.currentTime, next ? 0.003 : 0.05)
    }
  }, TICK_MS)

  return {
    stream: destination.stream,
    level: () => ({ db, open }),
    setEnabled: (value) => {
      enabled = value
      for (const track of raw.getAudioTracks()) track.enabled = value
    },
    aiActive: !!rnnoise,
    fellBack,
    stop: () => {
      clearInterval(timer)
      raw.getTracks().forEach((t) => t.stop())
      destination.stream.getTracks().forEach((t) => t.stop())
      rnnoise?.destroy()
      void ctx.close().catch(() => {})
    },
  }
}

// Cihaz listesi. İzin verilmeden önce Chromium cihaz adlarını gizler ve tek bir boş kayıt döner;
// bu durumda mikrofon kısa bir an açılıp kapatılır, sonra liste tekrar okunur.
export type AudioDevice = { deviceId: string; label: string }
export async function listAudioDevices(askPermission: boolean): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[]; defaultInput: string; defaultOutput: string }> {
  let list = await navigator.mediaDevices.enumerateDevices()
  const hidden = list.some((d) => d.kind === 'audioinput' && (!d.label || !d.deviceId))
  if (hidden && askPermission) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      probe.getTracks().forEach((t) => t.stop())
      list = await navigator.mediaDevices.enumerateDevices()
    } catch {
      // İzin yoksa adsız liste gösterilir.
    }
  }
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    list
      .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }))
  const defaultLabel = (kind: MediaDeviceKind) =>
    list.find((d) => d.kind === kind && d.deviceId === 'default')?.label.replace(/^(Default|Varsayılan)\s*-\s*/i, '') ?? ''
  return {
    inputs: pick('audioinput', 'Mikrofon'),
    outputs: pick('audiooutput', 'Hoparlör'),
    defaultInput: defaultLabel('audioinput'),
    defaultOutput: defaultLabel('audiooutput'),
  }
}
