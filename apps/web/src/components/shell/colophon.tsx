'use client';

import Link from 'next/link';
import { useChainId } from 'wagmi';
import { getChain, isMockEnvironment, isSupportedChain, publicEnv } from '@thematic/config';
import { Container } from '@/components/ui/layout.tsx';

/**
 * The foot of the page.
 *
 * Carries the standing risk disclosure (§49) and the deployment identity — which
 * chain, which factory — so that anyone looking at a screenshot of this app can
 * tell what they are looking at. §47 asks for "visible blockchain verification",
 * and the chain a set of figures came from is the first thing that qualifies
 * them.
 */
export function Colophon() {
  const chainId = useChainId();

  const chainName = isSupportedChain(chainId) ? getChain(chainId).name : `unsupported (${chainId})`;
  const configured = getChain(publicEnv.chainId).name;
  const mock = isMockEnvironment(chainId);

  return (
    <footer className="mt-8 border-t border-rule bg-sunken/60">
      <Container width="wide" className="py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-display text-lg text-ink">Thematic</p>
            <p className="mt-2 max-w-xs text-sm text-ink-muted">
              Weighted baskets of tokenized equities, held on-chain and redeemable at net asset
              value.
            </p>
          </div>

          <nav aria-label="Product">
            <p className="label">Product</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/baskets" className="text-ink-muted hover:text-ink">
                  All baskets
                </Link>
              </li>
              <li>
                <Link href="/create" className="text-ink-muted hover:text-ink">
                  Create a basket
                </Link>
              </li>
              <li>
                <Link href="/creator" className="text-ink-muted hover:text-ink">
                  Creator studio
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="About">
            <p className="label">Before you invest</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/disclosures" className="text-ink-muted hover:text-ink">
                  Risk disclosures
                </Link>
              </li>
              <li>
                <Link href="/disclosures#fees" className="text-ink-muted hover:text-ink">
                  How fees work
                </Link>
              </li>
              <li>
                <Link href="/disclosures#mock" className="text-ink-muted hover:text-ink">
                  What is simulated
                </Link>
              </li>
              <li>
                <Link href="/diagnostics" className="text-ink-muted hover:text-ink">
                  Binance Web3 API
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <p className="label">Deployment</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Network</dt>
                <dd className="text-ink">{chainName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">This build targets</dt>
                <dd className="text-ink">{configured}</dd>
              </div>
              {/*
                "Prices" became ambiguous the moment the reference feed landed:
                there are now two kinds of figure on the page and only one of them
                is simulated. Naming which is which here is the difference between
                a summary and a misleading one.
              */}
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Basket prices</dt>
                <dd className={mock ? 'text-warning' : 'text-ink'}>
                  {mock ? 'Simulated' : 'External feed'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Reference prices</dt>
                <dd className="text-ink">Binance</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-10 border-t border-rule pt-6">
          <p className="max-w-4xl text-xs leading-relaxed text-ink-muted">
            <strong className="font-semibold text-ink">Not investment advice.</strong> Baskets hold
            tokenized assets whose value can fall as well as rise, and you can lose the amount you
            put in. The smart contracts behind this application are unaudited and may contain bugs.
            Blockchain transactions are irreversible: once a deposit or redemption is confirmed, it
            cannot be undone by this application or by anyone else. Past performance of any
            composition shown here is not a guide to future results, and nothing on this site is a
            promise or projection of return.
          </p>
        </div>
      </Container>
    </footer>
  );
}
