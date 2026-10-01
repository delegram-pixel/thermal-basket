'use client';

import { useChainId, useSwitchChain } from 'wagmi';
import { getChain, isSupportedChain, publicEnv } from '@thematic/config';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';

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
 */
export function NetworkGuard() {
  const chainId = useChainId();
  const { switchChain, isPending, error } = useSwitchChain();

  if (isSupportedChain(chainId)) return null;

  // The chain this build is configured for, not a hard-coded testnet. A local
  // build told to switch to BNB testnet would send the user somewhere the
  // contracts do not exist.
  const target = getChain(publicEnv.chainId);

  return (
    <div className="rounded border border-negative/30 bg-negative-soft px-5 py-4">
      <p className="text-sm font-semibold text-ink">
        Your wallet is on a network this app does not support.
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Balances and baskets cannot be read until you switch. Nothing has been sent and nothing is
        at risk.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
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

      {error ? <p className="mt-2 text-xs text-negative">{error.message}</p> : null}
    </div>
  );
}
