import { useEffect, useRef, useState } from 'react'
import { Button, Field } from '@/components/ui'
import { applyDeviceChange } from '@/voice/engine'
import { useVoice } from '@/voice/store'

type Device = { deviceId: string; label: string }

export function VoiceSettings() {
  const prefs = useVoice()
  const [inputs, setInputs] = useState<Device[]>([])
  const [outputs, setOutputs] = useState<Device[]>([])
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  async function loadDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const map = (kind: MediaDeviceKind) =>
        list
          .filter((d) => d.kind === kind)
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Mikrofon' : 'Hoparlör'} ${i + 1}` }))
      setInputs(map('audioinput'))
      setOutputs(map('audiooutput'))
    } catch {
      setError('Ses cihazları listelenemedi.')
    }
  }

  useEffect(() => {
    void loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
      stopRef.current?.()
    }
  }, [])

  async function toggleTest() {
    if (testing) {
      stopRef.current?.()
      stopRef.current = null
      setTesting(false)
      setLevel(0)
      return
    }
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: prefs.inputDeviceId !== 'default' ? { ideal: prefs.inputDeviceId } : undefined,
          noiseSuppression: prefs.noiseSuppression,
          echoCancellation: prefs.echoCancellation,
        },
      })
      void loadDevices() // izin verildikten sonra cihaz adları görünür
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += ((v - 128) / 128) ** 2
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 6))
      }, 60)
      stopRef.current = () => {
        clearInterval(timer)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
      }
      setTesting(true)
    } catch {
      setError('Mikrofon açılamadı. Windows Ayarları > Gizlilik > Mikrofon izinlerini kontrol et.')
    }
  }

  function update(patch: Parameters<typeof prefs.setPrefs>[0]) {
    prefs.setPrefs(patch)
    void applyDeviceChange()
  }

  return (
    <section className="space-y-5">
      <h3 className="text-base font-bold text-fg">Ses ve mikrofon</h3>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Mikrofon">
          <select
            value={prefs.inputDeviceId}
            onChange={(e) => update({ inputDeviceId: e.target.value })}
            className="h-10 w-full rounded-md border border-line bg-input px-2 text-sm text-fg"
          >
            <option value="default">Varsayılan</option>
            {inputs
              .filter((d) => d.deviceId !== 'default')
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Hoparlör / kulaklık">
          <select
            value={prefs.outputDeviceId}
            onChange={(e) => update({ outputDeviceId: e.target.value })}
            className="h-10 w-full rounded-md border border-line bg-input px-2 text-sm text-fg"
          >
            <option value="default">Varsayılan</option>
            {outputs
              .filter((d) => d.deviceId !== 'default')
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
          </select>
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold tracking-wide text-muted uppercase">Mikrofon testi</p>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => void toggleTest()}>
            {testing ? 'Testi durdur' : 'Mikrofonu dene'}
          </Button>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-input">
            <div className="h-full rounded-full bg-online transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        </div>
        <p className="text-xs text-faint">Konuşunca çubuk yeşil dolmalı.</p>
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line p-3">
        <span>
          <span className="block text-sm font-medium text-fg">Gürültü engelleme</span>
          <span className="block text-xs text-muted">Klavye, fan ve arka plan seslerini azaltır.</span>
        </span>
        <input
          type="checkbox"
          className="size-5 accent-[#e30a17]"
          checked={prefs.noiseSuppression}
          onChange={(e) => update({ noiseSuppression: e.target.checked })}
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line p-3">
        <span>
          <span className="block text-sm font-medium text-fg">Yankı engelleme</span>
          <span className="block text-xs text-muted">Hoparlörden çıkan sesin mikrofona geri girmesini önler.</span>
        </span>
        <input
          type="checkbox"
          className="size-5 accent-[#e30a17]"
          checked={prefs.echoCancellation}
          onChange={(e) => update({ echoCancellation: e.target.checked })}
        />
      </label>
    </section>
  )
}
