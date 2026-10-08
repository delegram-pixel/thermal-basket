'use client';

import { useChainId, useSwitchChain } from 'wagmi';
import { getChain, isSupportedChain, publicEnv } from '@thematic/config';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Container } from '@/components/ui/layout.tsx';

/**
 * Which chain the wallet is on.
 *
 * Always rendered, including when the answer is "none of ours". A network
 * indicator that disappears on an unsupported chain leaves the user looking at
 * figures from one deployment with a wallet pointed at another and nothing on
 * screen saying so.
 */
export function NetworkBadge({ className = '' }: { className?: string }) {
  const chainId = useChainId();

  if (!isSupportedChain(chainId)) {
    return (
      <Badge tone="negative" className={className}>
        Unsupported network
      </Badge>
    );
  }

  const chain = getChain(chainId);

  return (
    <span className={`inline-box gap-1.5 text-xs text-ink-muted ${className}`}>
      <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-positive" />
      <span className="font-medium text-ink">{chain.name}</span>
      {/* Hardhat's chain has no testnet of its own; calling it one would be a
          small lie in a place where the whole point is knowing what you are
          looking at. */}
      {chain.testnet ? <span className="text-ink-faint">testnet</span> : null}
    </span>
  );
}

/**
 * The wrong-network state, as an action rather than a warning.
 *
 * §20 lists "request network switch where supported" next to "detect wrong
 * network", and the ordering is the point: detecting it and then doing nothing
 * leaves the user to open their wallet and find the setting themselves.
 *
 * Detection is against the *configured* chain, not against the supported list.
 * This app reads exactly one deployment — `getAddressBook()` returns the
 * addresses for `publicEnv.chainId` — so a wallet parked on another supported
 * chain is just as wrong as one on a chain nobody supports, and the failure is
 * quieter: the reads go out against addresses where no contract exists, and the
 * page renders empty with no explanation. Asking "is this chain supported?" and
 * stopping there left exactly that case uncovered.
 */
export function NetworkGuard() {
  const chainId = useChainId();
  const { switchChain, isPending, error } = useSwitchChain();

  if (chainId === publicEnv.chainId) return null;

  // The chain this build is configured for, not a hard-coded testnet. A local
  // build told to switch to BNB testnet would send the user somewhere the
  // contracts do not exist.
  const target = getChain(publicEnv.chainId);
  const current = isSupportedChain(chainId) ? getChain(chainId).name : 'an unsupported network';

  return (
    // A full-bleed band rather than a card inside one: the masthead it sits in is
    // built from hairlines and full-width ground, and a rounded panel floating
    // inside a striped band would put two rules a few pixels apart and read as a
    // dialog that lost its overlay.
    <div className="border-t border-rule bg-negative-soft">
      <Container width="wide" className="py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              Your wallet is on {current}, but this app reads a deployment on {target.name}.
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Balances and baskets cannot be read until you switch. Nothing has been sent and
              nothing is at risk.
            </p>
            {error ? <p className="mt-1.5 text-xs text-negative">{error.message}</p> : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="primary"
              busy={isPending}
              onClick={() => switchChain({ chainId: target.id })}
            >
              Switch to {target.name}
            </Button>
            <span className="text-xs text-ink-faint">or switch manually in your wallet</span>
          </div>
        </div>
      </Container>
    </div>
  );
}
