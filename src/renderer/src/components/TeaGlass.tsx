// Boş ekranlardaki küçük çizim: ince belli bardakta, tabağında, dumanı tüten çay.
// Bardak ve tabak yazı rengini (currentColor) kullanır; çayın rengi sabittir.
const GLASS = 'M32 24 C32 37 40 43 40 51 C40 59 34 63 35 72 L61 72 C62 63 56 59 56 51 C56 43 64 37 64 24 Z'

export function TeaGlass({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden>
      <clipPath id="turkcord-bardak">
        <path d={GLASS} />
      </clipPath>
      <rect x="28" y="31" width="40" height="45" fill="#b4441a" opacity="0.9" clipPath="url(#turkcord-bardak)" />
      <path d={GLASS} stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="48" cy="77" rx="25" ry="5" stroke="currentColor" strokeWidth="3" />
      <path d="M42 16 C39 12 45 10 42 5 M54 16 C51 12 57 10 54 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}
