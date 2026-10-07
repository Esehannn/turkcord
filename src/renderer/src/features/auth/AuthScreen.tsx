import { useState, type FormEvent } from 'react'
import { Logo, Wordmark } from '@/components/Logo'
import { Button, Field, Input, Tabs } from '@/components/ui'
import { errorMessage, functionErrorCode } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { checkPassword, PASSWORD_MESSAGES } from '@shared/password'
import { normalizeUsername, usernameProblem, usernameToEmail } from '@shared/username'

type Mode = 'login' | 'register'

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')
  return (
    <div className="relative flex h-full overflow-y-auto bg-accent p-6">
      <Backdrop />
      <div className="relative m-auto w-full max-w-sm rounded-2xl bg-elevated p-7 shadow-pop">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={56} />
          <h1 className="text-2xl">
            <Wordmark />
          </h1>
          <p className="text-sm text-muted">
            {mode === 'login' ? 'Tekrar hoş geldin! Çaylar taze.' : 'Davet kodunla aramıza katıl.'}
          </p>
        </div>
        <div className="mb-5 flex justify-center">
          <Tabs<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'login', label: 'Giriş Yap' },
              { value: 'register', label: 'Kayıt Ol' },
            ]}
          />
        </div>
        {mode === 'login' ? <LoginForm /> : <RegisterForm onDone={() => setMode('login')} />}
      </div>
    </div>
  )
}

function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const name = normalizeUsername(username)
    if (!name || !password) {
      setError('Kullanıcı adı ve şifre gerekli.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(name), password })
    setBusy(false)
    if (error) setError(errorMessage(error))
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Kullanıcı adı">
        <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="Şifre">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-accent">{error}</p>}
      <Button type="submit" loading={busy} className="w-full">
        Giriş Yap
      </Button>
      <p className="text-center text-xs text-faint">Şifreni unuttuysan yöneticiden yeni şifre iste.</p>
    </form>
  )
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [invite, setInvite] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)

  const name = normalizeUsername(username)
  const nameProblem = name ? usernameProblem(name) : null
  const passwordProblem = password ? checkPassword(password, name) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setError(null)
    if (!invite.trim()) return setError('Davet kodu gerekli.')
    if (usernameProblem(name)) return setError(usernameProblem(name))
    const problem = checkPassword(password, name)
    if (problem) return setError(PASSWORD_MESSAGES[problem])
    if (password !== password2) return setError('Şifreler aynı değil.')

    setBusy(true)
    const { error } = await supabase.functions.invoke('kayit', {
      body: { invite_code: invite.trim(), username: name, display_name: displayName.trim(), password },
    })
    if (error) {
      setBusy(false)
      setError(errorMessage((await functionErrorCode(error)) ?? error))
      return
    }
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: usernameToEmail(name), password })
    setBusy(false)
    if (loginError) {
      setError(errorMessage(loginError))
      onDone()
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <Field label="Davet kodu" hint="Yöneticiden aldığın kod (ör. ABCDE-FGHJK)">
        <Input autoFocus value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} spellCheck={false} />
      </Field>
      <Field label="Kullanıcı adı" hint="Giriş için kullanılır: küçük harf, rakam, nokta, alt çizgi" error={touched ? nameProblem : null}>
        <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
      </Field>
      <Field label="Görünen ad" hint="Herkesin göreceği ad, Türkçe karakter kullanabilirsin">
        <Input maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={name || 'Ör. Ayşe'} />
      </Field>
      <Field label="Şifre" error={touched && passwordProblem ? PASSWORD_MESSAGES[passwordProblem] : null} hint="En az 8 karakter, harf ve rakam">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Şifre (tekrar)">
        <Input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-accent">{error}</p>}
      <Button type="submit" loading={busy} className="w-full">
        Kayıt Ol
      </Button>
    </form>
  )
}

// Arka planda hafif hilal ve yıldız desenleri.
function Backdrop() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.08]" aria-hidden>
      <defs>
        <pattern id="turkcord-desen" width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
          <g transform="translate(20 20) scale(0.9)" style={{ color: '#fff' }}>
            <Logo size={64} variant="mark" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#turkcord-desen)" />
    </svg>
  )
}
