import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Newsreader, Spline_Sans_Mono } from 'next/font/google';
import { Providers } from './providers.tsx';
import { Masthead } from '@/components/shell/masthead.tsx';
import { Colophon } from '@/components/shell/colophon.tsx';
import './globals.css';

/**
 * The type system (§25).
 *
 * Three faces, each with a stated job, none of them from the previous project's
 * list:
 *
 * - **Newsreader** — a serif with genuine editorial bearing, used for page
 *   titles and basket names. It is what makes a page of figures read as a
 *   research note rather than as a dashboard. Never used for a control.
 * - **Instrument Sans** — a humanist grotesk for everything interactive and
 *   running. Chosen over the usual startup defaults because it has a bit more
 *   contrast in the joints, which holds up at the small sizes a fee table needs.
 * - **Spline Sans Mono** — for figures compared down a column, and for
 *   addresses and hashes. Restrained: it never sets a sentence.
 *
 * All three are variable fonts served from this origin by Next, so there is no
 * render-blocking request to a third party and no layout shift when they land.
 */
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-sans',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-newsreader',
});

const splineMono = Spline_Sans_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-spline-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'Thematic — baskets of tokenized stocks',
    template: '%s · Thematic',
  },
  description:
    'Create and invest in weighted baskets of tokenized equities on BNB Smart Chain. Transparent composition, on-chain fees, redeemable at net asset value.',
  applicationName: 'Thematic',
};

export const viewport: Viewport = {
  // Matches `--color-paper`, so the browser's own chrome does not flash white
  // against a warm page on a phone.
  themeColor: '#faf9f6',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${newsreader.variable} ${splineMono.variable}`}
    >
      <body className="min-h-dvh antialiased">
        {/* First in the tab order, and invisible until it is focused. A page
            with a masthead, a filter bar and a table is a lot of tabbing to skip
            past on every navigation. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>

        <Providers>
          <div className="flex min-h-dvh flex-col">
            <Masthead />
            <main id="main" className="flex-1">
              {children}
            </main>
            <Colophon />
          </div>
        </Providers>
      </body>
    </html>
  );
}
