import { create } from 'zustand'
import { errorMessage } from '@/lib/errors'

export type Toast = { id: number; text: string; tone: 'info' | 'error' | 'success' }

type ToastState = {
  toasts: Toast[]
  push: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, tone = 'info') => {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] })
    setTimeout(() => get().dismiss(id), tone === 'error' ? 6000 : 3500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = {
  info: (text: string) => useToasts.getState().push(text, 'info'),
  success: (text: string) => useToasts.getState().push(text, 'success'),
  error: (error: unknown) => useToasts.getState().push(errorMessage(error), 'error'),
}
