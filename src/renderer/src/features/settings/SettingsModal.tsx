import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, KeyRound, LogOut, Mic, Monitor, Palette, Play, ShieldCheck, Square, User } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { confirmDialog, Modal } from '@/components/Modal'
import { Button, Field, Input } from '@/components/ui'
import { useActions } from '@/data/actions'
import { useProfile } from '@/data/queries'
import { errorMessage } from '@/lib/errors'
import { removeImage, uploadAvatar } from '@/lib/images'
import { showNotification } from '@/lib/notify'
import {
  clearCustomRingtone,
  customRingtone,
  previewSound,
  RINGTONES,
  saveCustomRingtone,
  startRingtone,
  type NotifySound,
  type Ringtone,
} from '@/lib/sounds'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/stores/session'
import { toast } from '@/stores/toast'
import { useUi, type Theme } from '@/stores/ui'
import { checkPassword, PASSWORD_MESSAGES } from '@shared/password'
import { AdminPanel } from './AdminPanel'
import { VoiceSettings } from './VoiceSettings'

type Tab = 'profile' | 'voice' | 'appearance' | 'notifications' | 'desktop' | 'account' | 'admin'

export function SettingsModal({ initialTab = 'profile', onClose }: { initialTab?: Tab; onClose: () => void }) {
  const me = useSession((s) => s.session?.user.id) ?? ''
  const profile = useProfile(me)
  const [tab, setTab] = useState<Tab>(initialTab)

  const tabs: { value: Tab; label: string; icon: typeof User; show: boolean }[] = [
    { value: 'profile', label: 'Profil', icon: User, show: true },
    { value: 'voice', label: 'Ses ve Mikrofon', icon: Mic, show: true },
    { value: 'appearance', label: 'Görünüm', icon: Palette, show: true },
    { value: 'notifications', label: 'Bildirimler', icon: Bell, show: true },
    { value: 'desktop', label: 'Windows', icon: Monitor, show: !!window.turkcord?.desktopSettings },
    { value: 'account', label: 'Hesap', icon: KeyRound, show: true },
    { value: 'admin', label: 'Yönetici', icon: ShieldCheck, show: !!profile?.is_admin },
  ]

  return (
    <Modal title="Ayarlar" onClose={onClose} width="max-w-3xl">
      <div className="flex min-h-[420px] gap-6">
        <nav className="w-44 shrink-0 space-y-0.5">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                  tab === t.value ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'
                }`}
              >
                <t.icon className="size-4" />
                {t.label}
              </button>
            ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'profile' && <ProfileTab userId={me} />}
          {tab === 'voice' && <VoiceSettings />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'desktop' && <DesktopTab />}
          {tab === 'account' && <AccountTab username={profile?.username ?? ''} onClose={onClose} />}
          {tab === 'admin' && profile?.is_admin && <AdminPanel />}
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-base font-bold text-fg">{title}</h3>
      {children}
    </section>
  )
}

function ProfileTab({ userId }: { userId: string }) {
  const profile = useProfile(userId)
  const actions = useActions()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [status, setStatus] = useState(profile?.custom_status ?? '')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!profile) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    setBusy(true)
    try {
      await actions.updateProfile(userId, { display_name: displayName.trim(), custom_status: status.trim() || null })
    } finally {
      setBusy(false)
    }
  }

  async function changeAvatar(file: File) {
    setBusy(true)
    try {
      const path = await uploadAvatar(userId, file)
      const old = profile!.avatar_path
      await actions.updateProfile(userId, { avatar_path: path })
      void removeImage('gorseller', old)
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }

  async function clearAvatar() {
    const old = profile!.avatar_path
    await actions.updateProfile(userId, { avatar_path: null })
    void removeImage('gorseller', old)
  }

  return (
    <Section title="Profil">
      <div className="flex items-center gap-4">
        <Avatar name={profile.display_name} path={profile.avatar_path} size={80} />
        <div className="space-x-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>
            Avatar değiştir
          </Button>
          {profile.avatar_path && (
            <Button variant="ghost" onClick={() => void clearAvatar()}>
              Kaldır
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void changeAvatar(file)
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <form onSubmit={save} className="space-y-4">
        <Field label="Kullanıcı adı" hint="Kullanıcı adı değiştirilemez.">
          <Input value={`@${profile.username}`} disabled />
        </Field>
        <Field label="Görünen ad">
          <Input maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Durum mesajı" hint="Ör. 'Maçtayım', 'Çay demliyorum ☕'">
          <Input maxLength={80} value={status} onChange={(e) => setStatus(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!displayName.trim()}>
            Kaydet
          </Button>
        </div>
      </form>
    </Section>
  )
}

function AppearanceTab() {
  const theme = useUi((s) => s.theme)
  const setPrefs = useUi((s) => s.setPrefs)
  const options: { value: Theme; label: string; preview: string }[] = [
    { value: 'light', label: 'Açık (beyaz + kırmızı)', preview: 'bg-white' },
    { value: 'dark', label: 'Koyu (siyah + kırmızı)', preview: 'bg-[#1b1b1f]' },
  ]
  return (
    <Section title="Görünüm">
      <div className="grid grid-cols-2 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setPrefs({ theme: o.value })}
            className={`overflow-hidden rounded-lg border-2 text-left transition-colors ${
              theme === o.value ? 'border-accent' : 'border-line hover:border-faint'
            }`}
          >
            <div className={`flex h-20 ${o.preview}`}>
              <div className={`w-8 ${o.value === 'light' ? 'bg-[#e30a17]' : 'bg-[#121214]'}`} />
              <div className="flex-1 space-y-2 p-3">
                <div className="h-2 w-2/3 rounded bg-[#e30a17]/70" />
                <div className={`h-2 w-1/2 rounded ${o.value === 'light' ? 'bg-black/15' : 'bg-white/20'}`} />
              </div>
            </div>
            <p className="px-3 py-2 text-sm font-medium text-fg">{o.label}</p>
          </button>
        ))}
      </div>
    </Section>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line p-3">
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <input type="checkbox" className="size-5 accent-[#e30a17]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const SOUND_SAMPLES: { sound: NotifySound; label: string }[] = [
  { sound: 'message', label: 'Mesaj' },
  { sound: 'mention', label: 'Etiket' },
  { sound: 'friend', label: 'Arkadaşlık isteği' },
]

function NotificationsTab() {
  const notifications = useUi((s) => s.notifications)
  const banners = useUi((s) => s.banners)
  const sounds = useUi((s) => s.sounds)
  const volume = useUi((s) => s.volume)
  const notifyAll = useUi((s) => s.notifyAll)
  const effects = useUi((s) => s.effects)
  const setPrefs = useUi((s) => s.setPrefs)
  return (
    <div className="space-y-8">
      <Section title="Bildirimler">
        <Toggle
          label="Masaüstü bildirimleri"
          hint="Turkcord arkadayken özel mesaj, etiketlenme, arama ve arkadaşlık isteklerinde Windows bildirimi göster."
          checked={notifications}
          onChange={(v) => setPrefs({ notifications: v })}
        />
        <Toggle
          label="Uygulama içi bildirim kartları"
          hint="Turkcord öndeyken başka bir sohbetten mesaj gelince sağ üstte kart göster."
          checked={banners}
          onChange={(v) => setPrefs({ banners: v })}
        />
        <Toggle
          label="Sunucu kanallarındaki her mesajı bildir"
          hint="Kapalıyken sunucularda sadece etiketlendiğin mesajlar bildirilir; diğerleri okunmamış olarak işaretlenir."
          checked={notifyAll}
          onChange={(v) => setPrefs({ notifyAll: v })}
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() =>
              showNotification({ title: 'Deneme bildirimi', body: 'Bildirimler böyle görünecek ve böyle ses çıkaracak.', sound: 'message', avatar: { name: 'Turkcord' } })
            }
          >
            Bildirimi dene
          </Button>
        </div>
      </Section>

      <Section title="Sesler">
        <Toggle
          label="Bildirim sesleri"
          hint="Mesaj, etiket, arkadaşlık isteği ve arama sesleri."
          checked={sounds}
          onChange={(v) => setPrefs({ sounds: v })}
        />
        <div className={`rounded-lg border border-line p-3 ${sounds ? '' : 'opacity-50'}`}>
          <label className="block">
            <span className="flex justify-between text-sm font-medium text-fg">
              Ses seviyesi <span className="text-muted tabular-nums">%{Math.round(volume * 100)}</span>
            </span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              disabled={!sounds}
              value={Math.round(volume * 100)}
              onChange={(e) => setPrefs({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => previewSound('message', volume)}
              className="mt-2 w-full accent-[#e30a17]"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {SOUND_SAMPLES.map((sample) => (
              <Button key={sample.sound} variant="secondary" disabled={!sounds} onClick={() => previewSound(sample.sound, volume)}>
                <Play className="size-3.5" /> {sample.label}
              </Button>
            ))}
          </div>
        </div>
        <Toggle
          label="Ses efektlerini duy"
          hint="Ses kanalında ya da aramada başkalarının bastığı efektler (korna, alkış…) sende de çalsın."
          checked={effects}
          onChange={(v) => setPrefs({ effects: v })}
        />
        <RingtonePicker />
        <p className="text-xs text-faint">"Rahatsız Etmeyin" durumundayken bildirim ve ses gelmez; gelen aramalar sessizce gösterilir.</p>
      </Section>
    </div>
  )
}

function RingtonePicker() {
  const ringtone = useUi((s) => s.ringtone)
  const setPrefs = useUi((s) => s.setPrefs)
  const [hasCustom, setHasCustom] = useState(() => !!customRingtone())
  const [playing, setPlaying] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const stop = () => {
    stopRef.current?.()
    stopRef.current = null
    setPlaying(false)
  }
  useEffect(() => () => stopRef.current?.(), [])

  function toggle() {
    if (playing) return stop()
    stopRef.current = startRingtone(ringtone)
    setPlaying(true)
  }

  function choose(value: Ringtone) {
    stop()
    if (value === 'ozel' && !hasCustom) {
      fileRef.current?.click()
      return
    }
    setPrefs({ ringtone: value })
  }

  async function pick(file: File) {
    try {
      await saveCustomRingtone(file)
      setHasCustom(true)
      setPrefs({ ringtone: 'ozel' })
      toast.success('Arama melodin kaydedildi.')
    } catch (error) {
      toast.info(error instanceof Error ? error.message : 'Melodi kaydedilemedi.')
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-fg">Arama melodisi</p>
      <p className="text-xs text-muted">Biri seni aradığında çalar. Kendi ses dosyanı (mp3, ogg, wav; en fazla 1,5 MB) da seçebilirsin.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {RINGTONES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              ringtone === option.value ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:border-faint hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        ))}
        <Button variant="secondary" onClick={toggle}>
          {playing ? <Square className="size-3.5" /> : <Play className="size-3.5" />} {playing ? 'Durdur' : 'Dinle'}
        </Button>
      </div>
      {hasCustom && (
        <div className="mt-2 flex gap-3 text-xs">
          <button type="button" className="text-muted hover:text-fg hover:underline" onClick={() => fileRef.current?.click()}>
            Dosyayı değiştir
          </button>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              stop()
              clearCustomRingtone()
              setHasCustom(false)
              if (ringtone === 'ozel') setPrefs({ ringtone: 'mehter' })
            }}
          >
            Dosyayı kaldır
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void pick(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function DesktopTab() {
  const [settings, setSettings] = useState<{ closeToTray: boolean; openAtLogin: boolean } | null>(null)
  useEffect(() => {
    void window.turkcord?.desktopSettings().then(setSettings)
  }, [])
  async function update(patch: { closeToTray?: boolean; openAtLogin?: boolean }) {
    const next = await window.turkcord?.setDesktopSettings(patch)
    if (next) setSettings(next)
  }
  if (!settings) return null
  return (
    <Section title="Windows">
      <Toggle
        label="Windows açılınca başlat"
        hint="Bilgisayar açılınca Turkcord sağ alttaki simge olarak sessizce açılır."
        checked={settings.openAtLogin}
        onChange={(v) => void update({ openAtLogin: v })}
      />
      <Toggle
        label="Kapatınca simge durumuna küçült"
        hint="Pencereyi kapatınca Turkcord kapanmaz; sağ alttaki simgeye iner, mesajlar ve sesli sohbet devam eder. Tamamen kapatmak için simgeye sağ tıklayıp Çıkış'ı seç."
        checked={settings.closeToTray}
        onChange={(v) => void update({ closeToTray: v })}
      />
    </Section>
  )
}

function AccountTab({ username, onClose }: { username: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const problem = checkPassword(password, username)
    if (problem) return setError(PASSWORD_MESSAGES[problem])
    if (password !== password2) return setError('Şifreler aynı değil.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setPassword('')
    setPassword2('')
    toast.success('Şifren değiştirildi.')
  }

  async function signOut() {
    if (!(await confirmDialog({ title: 'Çıkış yap', text: 'Bu bilgisayardaki oturumun kapatılacak.', confirmLabel: 'Çıkış yap' }))) return
    onClose()
    await supabase.auth.signOut()
    qc.clear()
  }

  return (
    <div className="space-y-8">
      <Section title="Şifre değiştir">
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Yeni şifre" hint="En az 8 karakter, harf ve rakam">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Yeni şifre (tekrar)">
            <Input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-accent">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" loading={busy} disabled={!password}>
              Şifreyi değiştir
            </Button>
          </div>
        </form>
      </Section>
      <Section title="Oturum">
        <Button variant="danger" onClick={() => void signOut()}>
          <LogOut className="size-4" /> Çıkış yap
        </Button>
      </Section>
    </div>
  )
}
