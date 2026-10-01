'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Container } from '@/components/ui/layout.tsx';
import { WalletButton } from '@/components/wallet/wallet-button.tsx';
import { NetworkBadge } from '@/components/wallet/network-badge.tsx';

/**
 * The five destinations, in the order the product is used.
 *
 * Create sits between browsing and managing because that is where it happens:
 * you look at what exists, you compose your own, you come back to look after it.
 * It was missing until now, which left `/create` reachable only from the studio's
 * empty state — so a creator who already had a basket had no way back to the
 * form except by typing the URL. The product's central verb is not a page you
 * should have to know the address of.
 */
const NAV = [
  { href: '/', label: 'Discover' },
  { href: '/baskets', label: 'Baskets' },
  { href: '/create', label: 'Create' },
  { href: '/creator', label: 'Creator studio' },
  { href: '/disclosures', label: 'Disclosures' },
] as const;

/**
 * The masthead.
 *
 * Modelled on the top of a printed report rather than on a SaaS header: the
 * wordmark is set in the display serif, the navigation is plain text, and a
 * single hairline separates it from the page. There is no sticky translucent
 * blur, because §24 rules out decorative glass and because a blurred bar over a
 * column of figures is a readability problem, not a style choice.
 *
 * On a phone the navigation moves to its own row under the wordmark and scrolls
 * sideways. §28 asks for a mobile layout rather than a shrunken desktop one, and
 * a horizontal strip of destinations is the honest mobile form of a nav bar —
 * it keeps every destination one tap away instead of hiding them behind a
 * control that has to be opened first.
 *
 * That strip now carries the nav up to `lg` rather than up to `md`. Five
 * destinations, a wordmark and a wallet button do not fit across 768px without
 * either wrapping a label onto two lines or shrinking the type below the size
 * the rest of the chrome uses, and a nav that breaks its own labels is worse
 * than a nav that takes a second row. The crossover is set where the row
 * genuinely fits, not where the viewport is conventionally called "desktop".
 */
export function Masthead() {
  const pathname = usePathname();

  function isCurrent(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper">
      <Container width="wide">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Thematic, home">
            <AllocationMark />
            <span className="font-display text-xl tracking-[-0.02em] text-ink">Thematic</span>
          </Link>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-6 xl:gap-7">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isCurrent(item.href) ? 'page' : undefined}
                    className={`text-sm whitespace-nowrap transition-colors ${
                      isCurrent(item.href)
                        ? 'font-medium text-ink'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-3">
            <NetworkBadge className="hidden lg:inline-flex" />
            <WalletButton />
          </div>
        </div>
      </Container>

      <div className="border-t border-rule lg:hidden">
        <nav aria-label="Primary (compact)">
          {/* Gutters follow the Container, so the first destination lines up
              with the wordmark above it rather than sitting 12px to its left. */}
          <ul className="flex items-center gap-6 overflow-x-auto px-5 py-2.5 sm:px-8">
            {NAV.map((item) => (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={isCurrent(item.href) ? 'page' : undefined}
                  className={`text-sm whitespace-nowrap ${
                    isCurrent(item.href) ? 'font-medium text-ink' : 'text-ink-muted'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

/**
 * The mark: a weighted bar.
 *
 * It is the product's own central object — a basket's allocation, drawn to
 * scale — rather than an abstract shape that would need a story to explain it.
 * Four segments at the widths a diversified basket actually takes.
 */
function AllocationMark() {
  return (
    <svg viewBox="0 0 28 20" aria-hidden="true" className="h-5 w-7 shrink-0" role="presentation">
      <g fill="var(--color-accent)">
        <rect x="0" y="0" width="11" height="4" rx="1" />
        <rect x="12.5" y="0" width="7" height="4" rx="1" opacity="0.62" />
        <rect x="21" y="0" width="7" height="4" rx="1" opacity="0.34" />
      </g>
      <g fill="var(--color-ink)">
        <rect x="0" y="6" width="17" height="4" rx="1" opacity="0.85" />
        <rect x="18.5" y="6" width="9.5" height="4" rx="1" opacity="0.4" />
      </g>
      <g fill="var(--color-ink)">
        <rect x="0" y="12" width="7" height="4" rx="1" opacity="0.3" />
        <rect x="8.5" y="12" width="19.5" height="4" rx="1" opacity="0.55" />
      </g>
    </svg>
  );
}
