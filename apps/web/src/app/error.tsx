'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Container, Section } from '@/components/ui/layout.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Notice } from '@/components/ui/notice.tsx';

/**
 * The route error boundary.
 *
 * Two things this must not do. It must not show a stack trace — §21's rule that
 * a user never sees a raw machine string applies to render errors as much as to
 * reverted transactions. And it must not blame the user's wallet for a bug in
 * this application, which is the likelier cause of a render crash.
 *
 * `digest` is Next's hash of the server-side error. It is shown because it is
 * the one piece of information that makes a bug report actionable, and it
 * reveals nothing about the system.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept: the console is where a developer looks, and this is the only place
    // the real error still exists. The user-facing copy below is written
    // separately and deliberately does not interpolate it.
    console.error('Unhandled error in the application shell:', error);
  }, [error]);

  return (
    <Section className="pt-16 pb-24">
      <Container width="prose">
        <p className="label">Something broke</p>
        <h1 className="mt-2 text-[2rem] leading-tight sm:text-[2.5rem]">
          This page could not be rendered.
        </h1>

        <div className="mt-5 space-y-4 text-sm leading-relaxed text-ink-muted">
          <p>
            This is a fault in the interface, not in the contracts. No transaction has been sent,
            and nothing on-chain has changed as a result of this. Any position you hold is
            unaffected.
          </p>
          <p>
            Retrying often works, because the usual cause is a read that arrived in an unexpected
            shape — a price feed between two states, or a basket mid-deployment. If it keeps
            failing, the same basket is still readable on a block explorer, and the address in your
            wallet is still the address.
          </p>
        </div>

        {error.digest ? (
          <p className="mt-5 text-xs text-ink-faint">
            Reference for a bug report: <span className="figure">{error.digest}</span>
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="primary" size="lg" onClick={reset}>
            Try this page again
          </Button>
          <Link
            href="/baskets"
            className="inline-flex h-11 items-center justify-center rounded border border-rule-strong px-5 text-sm font-medium text-ink transition-colors hover:bg-sunken"
          >
            Back to the explorer
          </Link>
        </div>

        <div className="mt-10">
          <Notice tone="neutral" title="If you were in the middle of a transaction">
            A wallet transaction that was already submitted is not affected by a page failing to
            render. Check your wallet or a block explorer for its status before retrying it —
            sending it twice would deposit twice.
          </Notice>
        </div>
      </Container>
    </Section>
  );
}
