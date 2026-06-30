import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The bot is the source of truth and can change rows at any time; keep
      // data reasonably fresh but avoid hammering on every focus.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
