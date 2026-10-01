'use client';

import { useState } from 'react';
import { useChainId } from 'wagmi';
import { shortenAddress } from '@thematic/blockchain';
import { explorerAddressUrl } from '@thematic/config';
import type { Address } from '@thematic/types';

/**
 * An address, shown short, with the two things anyone ever does with one.
 *
 * §47 asks for "visible blockchain verification": the point of showing a
 * contract address is that a reader can go and check it. An address rendered as
 * plain text with no way to reach the explorer is a decoration that looks like
 * verification.
 */
export function AddressChip({
  address,
  label,
  visible = 4,
  className = '',
}: {
  address: Address;
  /** A leading caption, e.g. "Contract" or "Creator". */
  label?: string;
  visible?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const chainId = useChainId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      // Clipboard access is refused in some browsers and every non-secure
      // origin. The full address is still selectable, so this is a missing
      // convenience rather than a failure worth interrupting anyone over.
    }
  }

  const explorer = explorerAddressUrl(chainId, address);

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {label ? <span className="label">{label}</span> : null}

      <span className="figure text-ink" title={address}>
        {shortenAddress(address, visible)}
      </span>

      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        aria-label={copied ? 'Address copied' : `Copy address ${address}`}
      >
        {copied ? <CheckGlyph /> : <CopyGlyph />}
      </button>

      {explorer ? (
        <a
          href={explorer}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-accent"
          aria-label={`View ${address} on the block explorer`}
        >
          <ExternalGlyph />
        </a>
      ) : null}

      {/* The copy button's confirmation, announced rather than only drawn. */}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Address copied to clipboard' : ''}
      </span>
    </span>
  );
}

function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <rect x="4.75" y="4.75" width="7.5" height="7.5" rx="1.25" />
      <path
        d="M9.25 4.75v-1.5a1.25 1.25 0 0 0-1.25-1.25H2.75A1.25 1.25 0 0 0 1.5 3.25V8a1.25 1.25 0 0 0 1.25 1.25h1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="size-3.5 text-positive"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M2.75 7.5 5.75 10.5l5.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path
        d="M6 3H3.25A1.25 1.25 0 0 0 2 4.25v6.5A1.25 1.25 0 0 0 3.25 12h6.5A1.25 1.25 0 0 0 11 10.75V8"
        strokeLinecap="round"
      />
      <path d="M8.25 2H12v3.75M12 2 6.75 7.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
