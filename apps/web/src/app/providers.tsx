'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@thematic/blockchain';

/**
 * The two providers the app needs.
 *
 * Both are client components by necessity — a wagmi config holds a live
 * connection and a `QueryClient` holds a cache, and neither exists on the
 * server. They sit at the root so the server components above them stay server
 * components.
 *
 * The `QueryClient` is created in state rather than at module scope. At module
 * scope it would be shared across requests on the server, which means one
 * visitor's cached balances could be served to the next. It is the kind of bug
 * that only shows up under concurrency, on someone else's machine.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A wallet app refetches on focus rather than on a timer, so a
            // window left open does not poll a node for hours. The individual
            // hooks set their own staleness on top of this.
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
