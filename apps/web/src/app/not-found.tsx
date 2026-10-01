import Link from 'next/link';
import { Container, Section } from '@/components/ui/layout.tsx';

/**
 * 404.
 *
 * A not-found page on a dApp has an obligation a marketing site's does not: the
 * most likely reason someone reaches it is that a contract address in a URL does
 * not exist on the network they are connected to. So it says that, and offers
 * the explorer, rather than only apologising.
 */
export default function NotFound() {
  return (
    <Section className="pt-16 pb-24">
      <Container width="prose">
        <p className="label">Not found</p>
        <h1 className="mt-2 text-[2rem] leading-tight sm:text-[2.5rem]">
          There is nothing at this address.
        </h1>

        <div className="mt-5 space-y-4 text-sm leading-relaxed text-ink-muted">
          <p>
            If you followed a link to a basket, the usual cause is a network mismatch: basket
            contracts live on one chain, and an address from BNB testnet does not exist on BNB Smart
            Chain. Check which network your wallet is on and try the link again.
          </p>
          <p>
            The other possibility is that the basket was never deployed, or the link was mistyped.
            The explorer lists every basket the factory on your current network has created.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/baskets"
            className="inline-flex h-11 items-center justify-center rounded bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Browse every basket
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded border border-rule-strong px-5 text-sm font-medium text-ink transition-colors hover:bg-sunken"
          >
            Back to the front page
          </Link>
        </div>
      </Container>
    </Section>
  );
}
