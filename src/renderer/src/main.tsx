import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './App'
import { handleAuthError } from './lib/authGuard'
import { applyAppearance } from './stores/ui'

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

applyAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
