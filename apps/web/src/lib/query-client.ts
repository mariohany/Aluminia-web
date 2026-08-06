import { QueryClient } from '@tanstack/react-query'

// Control-plane data at this scale (250 companies, ~1250 users) barely
// changes minute to minute, so a short staleTime avoids refetch storms
// from route changes and window refocus while still catching up quickly
// after a mutation invalidates a query.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
