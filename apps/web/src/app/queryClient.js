import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => (err?.response?.status >= 400 && err?.response?.status < 500 ? false : count < 2),
    },
  },
});
