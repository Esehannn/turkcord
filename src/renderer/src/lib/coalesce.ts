// Art arda gelen çağrıları birleştirir: `run` en fazla `waitMs`'de bir çalışır, aynı anda iki kez çalışmaz
// ve son çağrıdan sonra mutlaka bir kez daha çalışır. `run` her seferinde güncel durumu kendisi okumalıdır.
// Örnek: mikrofonu hızlı hızlı aç-kapa yapınca her tıklamayı sunucuya yollamak yerine son durumu yollamak.
export function coalesce(
  run: () => void | Promise<void>,
  waitMs: number,
): { trigger: () => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false
  let lastRun = 0

  const fire = async (): Promise<void> => {
    timer = undefined
    if (running) {
      again = true
      return
    }
    running = true
    lastRun = Date.now()
    try {
      await run()
    } catch {
      // Bir sonraki tetiklemede yeniden denenir.
    } finally {
      running = false
      if (again) {
        again = false
        schedule()
      }
    }
  }

  const schedule = (): void => {
    if (timer) return
    timer = setTimeout(() => void fire(), Math.max(0, waitMs - (Date.now() - lastRun)))
  }

  return {
    trigger: () => {
      if (running) again = true
      else schedule()
    },
    // Beklemeden hemen çalıştırır (o an çalışıyorsa bitince bir kez daha çalışır).
    flush: () => {
      clearTimeout(timer)
      void fire()
    },
    cancel: () => {
      clearTimeout(timer)
      timer = undefined
      again = false
    },
  }
}
