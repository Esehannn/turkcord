import { Floating } from '@/components/Menu'

// Sık kullanılan emojiler. Harici kütüphane ya da ağ isteği yok.
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '☕', '🔥', '🇹🇷']

const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '😘', '😋',
  '😜', '🤪', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😫', '😩', '🥺',
  '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '🤔', '🤫', '🤭', '🙄',
  '😬', '😴', '🤤', '🤢', '🤮', '🤧', '😷', '🤒', '🤠', '🤡', '👻', '💀', '👽', '🤖', '💩', '🙈',
  '👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙌', '🙏', '💪', '👀', '👋', '🫡', '🤙', '✊', '🫶',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❤️‍🔥', '💯', '✨', '🔥', '⭐', '🌙', '🎉',
  '☕', '🍵', '🫖', '🥙', '🍢', '🥯', '🍉', '🍕', '🍔', '🍟', '🍰', '🍫', '🍺', '🥤', '🧿', '🇹🇷',
  '⚽', '🏀', '🎮', '🕹️', '🎧', '🎵', '🎸', '📺', '💻', '📱', '📸', '🚗', '✈️', '🏖️', '⏰', '💸',
]

// Kutu, kendisini açan düğmenin (anchor) üstüne ve sayfanın en üst katmanına çizilir; mesaj listesinin ya da
// yazı alanının sınırında kesilmez.
export function EmojiPicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <Floating x={anchor.right} y={anchor.top - 8} above flipY={anchor.bottom + 8} align="end" onClose={onClose} className="w-80 p-2">
      <div className="grid max-h-60 grid-cols-8 gap-0.5 overflow-x-hidden overflow-y-auto scroll-thin">
        {EMOJIS.map((emoji) => (
          <button key={emoji} type="button" onClick={() => onPick(emoji)} className="grid h-9 place-items-center rounded-md text-xl hover:bg-hover">
            {emoji}
          </button>
        ))}
      </div>
    </Floating>
  )
}
