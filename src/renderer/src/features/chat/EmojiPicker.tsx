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

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 bottom-full z-40 mb-2 w-80 rounded-lg border border-line bg-elevated p-2 shadow-pop">
        <div className="grid max-h-60 grid-cols-8 gap-0.5 overflow-y-auto scroll-thin">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              className="grid size-9 place-items-center rounded-md text-xl hover:bg-hover"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
