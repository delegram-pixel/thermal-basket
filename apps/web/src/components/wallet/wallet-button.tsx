'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useConnectors,
  useDisconnect,
} from 'wagmi';
import { formatAmount, shortenAddress } from '@thematic/blockchain';
import { explorerAddressUrl } from '@thematic/config';
import type { Address } from '@thematic/types';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { NetworkBadge } from './network-badge.tsx';

/**
 * Connect, identify, disconnect (§20).
 *
 * Two states, and neither of them is a lie. Disconnected, the button says what
 * it will do. Connected, it shows the address the app will actually transact
 * from — shortened, but with the full value one tap away, because the single
 * most common costly mistake in a dApp is not noticing which account is
 * selected.
 */
export function WalletButton() {
  const { address, status } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  if (status === 'connecting' || status === 'reconnecting') {
    return (
      <Button size="md" variant="secondary" disabled>
        Connecting…
      </Button>
    );
  }

  if (!address) {
    return (
      <>
        <Button size="md" variant="primary" onClick={() => setConnectOpen(true)}>
          Connect wallet
        </Button>
        <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
    );
  }

  return (
    <>
      <AccountChip
        address={address}
        open={menuOpen}
        onToggle={() => setMenuOpen((v) => !v)}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}

/**
 * The connector list.
 *
 * Only what the config actually holds. A grid of eight wallet logos where six
 * cannot connect is the most common way a connect dialog wastes someone's time.
 */
function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { mutateAsync: connect, isPending, error, reset } = useConnect();

  async function choose(connector: (typeof connectors)[number]) {
    try {
      await connect({ connector });
      onClose();
    } catch {
      // The message is rendered from `error` below. A rejection here is the
      // normal outcome of a user closing their wallet's own popup.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Connect a wallet"
      description="Your wallet holds your basket tokens and signs every transaction. This app never takes custody of anything."
    >
      <ul className="space-y-2">
        {connectors.map((connector) => (
          <li key={connector.uid}>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void choose(connector)}
              className="flex w-full items-center justify-between gap-4 rounded border border-rule px-4 py-3 text-left transition-colors hover:border-rule-strong hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>
                <span className="block text-sm font-medium text-ink">{connector.name}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {describeConnector(connector.type)}
                </span>
              </span>
              <span aria-hidden="true" className="text-ink-faint">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error.message}
        </p>
      ) : null}

      <p className="mt-5 text-xs text-ink-faint">
        Connecting shares your public address with this site. It does not grant access to your
        funds.
      </p>
    </Dialog>
  );
}

function describeConnector(type: string): string {
  switch (type) {
    case 'injected':
      return 'The wallet extension or app already in this browser';
    case 'walletConnect':
      return 'Scan with a mobile wallet';
    case 'coinbaseWallet':
      return 'Coinbase Wallet';
    default:
      return 'External wallet';
  }
}

/**
 * The connected account, and the menu behind it.
 *
 * Dismisses on Escape and on a click outside. Both are wired by hand rather
 * than with a `<details>` element, because a `details` panel cannot be closed
 * by clicking away and on a phone that means the user has to find the chip
 * again to get rid of it.
 */
function AccountChip({
  address,
  open,
  onToggle,
  onClose,
}: {
  address: Address;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  // The chain the wallet is on, not a chain id carried by the balance: wagmi
  // returns only the figure, and the balance is a balance *of* whatever chain
  // the wallet is on. Linking it to a different chain's explorer would send a
  // reader to a page about an unrelated chain.
  const chainId = useChainId();
  const explorer = explorerAddressUrl(chainId, address);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      /* see AddressChip */
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-10 items-center gap-2 rounded border border-rule-strong bg-surface px-3 text-sm transition-colors hover:border-ink-faint"
      >
        <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-positive" />
        <span className="figure text-ink">{shortenAddress(address)}</span>
        <svg
          viewBox="0 0 10 10"
          aria-hidden="true"
          className={`size-2.5 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Wallet"
          className="animate-rise absolute right-0 z-40 mt-2 w-72 rounded border border-rule-strong bg-raised shadow-lg"
        >
          <div className="border-b border-rule px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="label">Connected</span>
              <NetworkBadge />
            </div>
            <p className="figure mt-1.5 text-sm break-all text-ink">{address}</p>
            {balance ? (
              <p className="mt-1 text-sm text-ink-muted">
                <span className="figure text-ink">
                  {formatAmount(balance.value, balance.decimals, {
                    displayDecimals: 4,
                    minDecimals: 4,
                  })}
                </span>{' '}
                {balance.symbol}
                <span className="ml-1 text-xs text-ink-faint">for gas</span>
              </p>
            ) : null}
          </div>

          <div className="p-1.5">
            <MenuItem onClick={() => void copy()}>
              {copied ? 'Address copied' : 'Copy address'}
            </MenuItem>

            {explorer ? (
              <MenuItem href={explorer} external>
                View on explorer
              </MenuItem>
            ) : null}

            <MenuItem
              onClick={() => {
                disconnect();
                onClose();
              }}
            >
              Disconnect
            </MenuItem>
          </div>

          <p aria-live="polite" className="sr-only">
            {copied ? 'Address copied to clipboard' : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  href,
  external = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
}) {
  const className =
    'block w-full rounded-sm px-2.5 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-sunken hover:text-ink';

  if (href) {
    return (
      <a
        href={href}
        className={className}
        {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
