import { StrictMode } from 'react'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { handleAuthError } from './lib/authGuard'
import { scheduleMuteExpiry } from './stores/ui'

const queryClient = new QueryClient({
  // Oturum geçersizse (401) yenilemeyi dener, olmazsa giriş ekranına döner.
  queryCache: new QueryCache({ onError: (error) => void handleAuthError(error) }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// Uygulama kapalıyken süresi dolan sessize almalar açılışta kaldırılır.
scheduleMuteExpiry()

export function Boot() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>
  )
}
