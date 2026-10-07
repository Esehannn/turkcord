// Turkcord logosu: hilal biçiminde bir konuşma balonu ve yanında yıldız.
// Bayrağın birebir kopyası değil, ondan esinlenen bir işaret.

const STAR = 'M38.30 31.00 L43.15 29.30 L43.28 24.15 L46.40 28.24 L51.32 26.77 L48.40 31.00 L51.32 35.23 L46.40 33.76 L43.28 37.85 L43.15 32.70 Z'

type LogoProps = {
  size?: number
  // tile: kırmızı kare zemin üzerinde beyaz işaret; mark: sadece işaret (rengi currentColor)
  variant?: 'tile' | 'mark'
  className?: string
  title?: string
}

export function Logo({ size = 40, variant = 'tile', className, title = 'Turkcord' }: LogoProps) {
  const fg = variant === 'tile' ? '#ffffff' : 'currentColor'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      {variant === 'tile' && <rect width="64" height="64" rx="16" fill="#e30a17" />}
      <mask id="turkcord-hilal">
        <rect width="64" height="64" fill="#fff" />
        <circle cx="32.5" cy="31" r="13.6" fill="#000" />
      </mask>
      <g fill={fg}>
        <circle cx="27" cy="31" r="17" mask="url(#turkcord-hilal)" />
        <path d="M14.5 40.5 L9 53 L23 45.8 Z" />
        <path d={STAR} />
      </g>
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className ?? ''}`}>
      Turk<span className="text-accent">cord</span>
    </span>
  )
}
