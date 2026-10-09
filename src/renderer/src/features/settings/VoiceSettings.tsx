import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Field } from '@/components/ui'
import { keyLabel } from '@/lib/keys'
import { applyDeviceChange } from '@/voice/engine'
import { AUTO_GATE_DB, listAudioDevices, micErrorMessage, openMicrophone, type AudioDevice, type Microphone } from '@/voice/mic'
import { useVoice, type NoiseMode } from '@/voice/store'
import { ShortcutSettings } from './ShortcutSettings'

// Ölçer -80 dB ile 0 dB arasını gösterir.
const toPercent = (db: number) => Math.min(100, Math.max(0, ((db + 80) / 80) * 100))

const NOISE_MODES: { value: NoiseMode; title: string; text: string }[] = [
  { value: 'guclu', title: 'Güçlü (yapay zekâ)', text: 'Klavye, fan, köpek, trafik gibi sesleri neredeyse tamamen siler. Önerilen.' },
  { value: 'standart', title: 'Standart', text: 'Hafif bir engelleme. Güçlü mod sesini bozuk yapıyorsa bunu dene.' },
  { value: 'kapali', title: 'Kapalı', text: 'Ses olduğu gibi gider. İyi bir mikrofonun ve sessiz bir odan varsa.' },
]

export function VoiceSettings() {
  const prefs = useVoice()
  const [inputs, setInputs] = useState<AudioDevice[]>([])
  const [outputs, setOutputs] = useState<AudioDevice[]>([])
  const [defaults, setDefaults] = useState({ input: '', output: '' })
  const [testing, setTesting] = useState(false)
  const [hearSelf, setHearSelf] = useState(false)
  const [level, setLevel] = useState({ db: -100, open: false })
  const [error, setError] = useState<string | null>(null)
  const [aiFailed, setAiFailed] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const testRef = useRef<{ mic: Microphone; timer: ReturnType<typeof setInterval>; audio: HTMLAudioElement } | null>(null)

  async function loadDevices(askPermission: boolean) {
    try {
      const result = await listAudioDevices(askPermission)
      setInputs(result.inputs)
      setOutputs(result.outputs)
      setDefaults({ input: result.defaultInput, output: result.defaultOutput })
      if (result.inputs.length === 0) setError('Hiç mikrofon bulunamadı. Takılı olduğundan ve Windows ses ayarlarında açık olduğundan emin ol.')
    } catch {
      setError('Ses cihazları listelenemedi.')
    }
  }

  useEffect(() => {
    void loadDevices(true)
    const onChange = () => void loadDevices(false)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
      stopTest()
    }
  }, [])

  function stopTest() {
    const current = testRef.current
    if (!current) return
    clearInterval(current.timer)
    current.audio.srcObject = null
    current.mic.stop()
    testRef.current = null
  }

  async function startTest() {
    stopTest()
    setError(null)
    try {
      const mic = await openMicrophone()
      const audio = new Audio()
      audio.srcObject = mic.stream
      audio.muted = !hearSelfRef.current
      const sink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      const { outputDeviceId } = useVoice.getState()
      if (sink.setSinkId && outputDeviceId !== 'default') void sink.setSinkId(outputDeviceId).catch(() => {})
      void audio.play().catch(() => {})
      const timer = setInterval(() => setLevel(mic.level()), 50)
      testRef.current = { mic, timer, audio }
      setAiFailed(useVoice.getState().noiseMode === 'guclu' && !mic.aiActive)
      if (mic.fellBack) setError('Seçtiğin mikrofon bulunamadı, varsayılan mikrofon kullanılıyor.')
      setTesting(true)
      void loadDevices(false) // izin verildikten sonra cihaz adları görünür
    } catch (e) {
      setError(micErrorMessage(e))
      setTesting(false)
    }
  }

  const hearSelfRef = useRef(hearSelf)
  hearSelfRef.current = hearSelf
  useEffect(() => {
    if (testRef.current) testRef.current.audio.muted = !hearSelf
  }, [hearSelf])

  function toggleTest() {
    if (testing) {
      stopTest()
      setTesting(false)
      setLevel({ db: -100, open: false })
    } else {
      void startTest()
    }
  }

  function update(patch: Parameters<typeof prefs.setPrefs>[0]) {
    prefs.setPrefs(patch)
    // Sadece hoparlör değiştiyse mikrofonu yeniden açmaya gerek yok.
    const micChanged = !('outputDeviceId' in patch)
    void applyDeviceChange(micChanged)
    if (testRef.current) void startTest()
  }

  // Bas-konuş tuşunu yakala.
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code !== 'Escape') prefs.setPrefs({ pttKey: e.code })
      setCapturing(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, prefs])

  const threshold = prefs.autoGate ? AUTO_GATE_DB : prefs.gateDb

  return (
    <section className="space-y-6">
      <h3 className="text-base font-bold text-fg">Ses ve mikrofon</h3>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Mikrofon">
          <DeviceSelect
            value={prefs.inputDeviceId}
            devices={inputs}
            defaultLabel={defaults.input}
            onChange={(inputDeviceId) => update({ inputDeviceId })}
          />
        </Field>
        <Field label="Hoparlör / kulaklık">
          <DeviceSelect
            value={prefs.outputDeviceId}
            devices={outputs}
            defaultLabel={defaults.output}
            onChange={(outputDeviceId) => update({ outputDeviceId })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <SectionTitle>Mikrofon testi</SectionTitle>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={toggleTest}>
            {testing ? 'Testi durdur' : 'Mikrofonu dene'}
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="size-4 accent-accent" checked={hearSelf} onChange={(e) => setHearSelf(e.target.checked)} />
            Kendi sesimi duy
          </label>
        </div>
        <LevelBar db={level.db} open={level.open} threshold={threshold} active={testing} />
        <p className="text-xs text-faint">
          Konuşunca çubuk dolmalı; yeşil yanıyorsa sesin karşıya gidiyor. Kulaklıkla "Kendi sesimi duy"u açıp gürültü engellemeyi dinleyebilirsin.
        </p>
        {aiFailed && <p className="text-sm text-idle">Yapay zekâ gürültü engelleme bu bilgisayarda açılamadı, ses işlenmeden gidiyor. "Standart"ı seç.</p>}
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>

      <div className="space-y-2">
        <SectionTitle>Gürültü engelleme</SectionTitle>
        <div className="grid gap-2">
          {NOISE_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                prefs.noiseMode === mode.value ? 'border-accent bg-accent/5' : 'border-line hover:bg-hover'
              }`}
            >
              <input
                type="radio"
                name="noise"
                className="mt-0.5 size-4 accent-accent"
                checked={prefs.noiseMode === mode.value}
                onChange={() => update({ noiseMode: mode.value })}
              />
              <span>
                <span className="block text-sm font-medium text-fg">{mode.title}</span>
                <span className="block text-xs text-muted">{mode.text}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <SectionTitle>Giriş hassasiyeti</SectionTitle>
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line p-3">
          <span>
            <span className="block text-sm font-medium text-fg">Otomatik</span>
            <span className="block text-xs text-muted">Kapatırsan, çizginin altında kalan sesler (nefes, uzaktaki konuşma) iletilmez.</span>
          </span>
          <input
            type="checkbox"
            className="size-5 accent-accent"
            checked={prefs.autoGate}
            onChange={(e) => prefs.setPrefs({ autoGate: e.target.checked })}
          />
        </label>
        {!prefs.autoGate && (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={-80}
              max={-10}
              step={1}
              value={prefs.gateDb}
              onChange={(e) => prefs.setPrefs({ gateDb: Number(e.target.value) })}
              className="flex-1 accent-accent"
              aria-label="Giriş hassasiyeti"
            />
            <span className="w-14 text-right text-xs text-muted tabular-nums">{prefs.gateDb} dB</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <SectionTitle>Konuşma modu</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['ses', 'Sesle etkinleşme', 'Konuşunca mikrofon kendiliğinden açılır.'],
              ['bas-konus', 'Bas-konuş', 'Tuşa basılı tuttuğun sürece konuşursun.'],
            ] as const
          ).map(([value, title, text]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                prefs.inputMode === value ? 'border-accent bg-accent/5' : 'border-line hover:bg-hover'
              }`}
            >
              <input
                type="radio"
                name="input-mode"
                className="mt-0.5 size-4 accent-accent"
                checked={prefs.inputMode === value}
                onChange={() => prefs.setPrefs({ inputMode: value })}
              />
              <span>
                <span className="block text-sm font-medium text-fg">{title}</span>
                <span className="block text-xs text-muted">{text}</span>
              </span>
            </label>
          ))}
        </div>
        {prefs.inputMode === 'bas-konus' && (
          <div className="flex items-center gap-3 rounded-lg border border-line p-3">
            <span className="flex-1 text-sm text-fg">Bas-konuş tuşu</span>
            <Button variant="secondary" className="min-w-28" onClick={() => setCapturing(true)}>
              {capturing ? 'Bir tuşa bas…' : keyLabel(prefs.pttKey)}
            </Button>
          </div>
        )}
        {prefs.inputMode === 'bas-konus' && (
          <p className="text-xs text-faint">Şimdilik Turkcord penceresi öndeyken çalışır. Oyundayken "Mikrofonu kapat/aç" kısayolunu kullanabilirsin.</p>
        )}
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line p-3">
        <span>
          <span className="block text-sm font-medium text-fg">Yankı engelleme</span>
          <span className="block text-xs text-muted">Hoparlörden çıkan sesin mikrofona geri girmesini önler. Kulaklık kullanıyorsan kapatabilirsin.</span>
        </span>
        <input
          type="checkbox"
          className="size-5 accent-accent"
          checked={prefs.echoCancellation}
          onChange={(e) => update({ echoCancellation: e.target.checked })}
        />
      </label>

      <ShortcutSettings />
    </section>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-xs font-bold tracking-wide text-muted uppercase">{children}</p>
}

function DeviceSelect({
  value,
  devices,
  defaultLabel,
  onChange,
}: {
  value: string
  devices: AudioDevice[]
  defaultLabel: string
  onChange: (value: string) => void
}) {
  const missing = value !== 'default' && devices.length > 0 && !devices.some((d) => d.deviceId === value)
  return (
    <select
      value={missing ? 'default' : value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-line bg-input px-2 text-sm text-fg"
    >
      <option value="default">{defaultLabel ? `Windows varsayılanı (${defaultLabel})` : 'Windows varsayılanı'}</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label}
        </option>
      ))}
    </select>
  )
}

function LevelBar({ db, open, threshold, active }: { db: number; open: boolean; threshold: number; active: boolean }) {
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-input">
      <div
        className={`h-full rounded-full transition-[width] duration-75 ${open ? 'bg-online' : 'bg-faint/60'}`}
        style={{ width: `${active ? toPercent(db) : 0}%` }}
      />
      <div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${toPercent(threshold)}%` }} title="Hassasiyet eşiği" />
    </div>
  )
}
