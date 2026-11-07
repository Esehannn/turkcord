import { create } from 'zustand'
import { errorMessage } from '@/lib/errors'

// action: bildirimin üstünde bir düğme (ör. "İzle"); basınca bildirim kapanır.
export type Toast = { id: number; text: string; tone: 'info' | 'error' | 'success'; action?: { label: string; run: () => void } }

type ToastState = {
  toasts: Toast[]
  push: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, tone = 'info', action) => {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone, action }] })
    setTimeout(() => get().dismiss(id), tone === 'error' || action ? 6000 : 3500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = {
  info: (text: string) => useToasts.getState().push(text, 'info'),
  success: (text: string) => useToasts.getState().push(text, 'success'),
  error: (error: unknown) => useToasts.getState().push(errorMessage(error), 'error'),
  action: (text: string, label: string, run: () => void) => useToasts.getState().push(text, 'info', { label, run }),
}
