/**
 * Next configuration.
 *
 * `transpilePackages` is the important line. The workspace packages ship
 * TypeScript source rather than built JavaScript — `@thematic/blockchain`'s
 * entry point is literally `./src/index.ts` — because the alternative is a build
 * step between editing a read function and seeing the result in the browser, and
 * a stale `dist/` is a class of bug that costs an afternoon to find.
 *
 * The cost of that choice is that the bundler has to compile them, which is what
 * this option asks for.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,

  transpilePackages: [
    '@thematic/blockchain',
    '@thematic/config',
    '@thematic/types',
    '@thematic/contracts',
  ],

  /**
   * Node-only packages that reach the browser bundle through WalletConnect.
   *
   * wagmi's connector set statically imports WalletConnect, whose transport
   * pulls in `pino` (logging), `lokijs` (its key-value store) and `encoding` —
   * none of which has a browser build. Next's Turbopack resolves these to empty
   * modules rather than failing the build, which is the right outcome: the code
   * paths that would call them are the WalletConnect relay's, and they are only
   * reached at all when a WalletConnect project id is configured.
   *
   * This replaced a `webpack` externals block. Under Next 16 Turbopack is the
   * default bundler and a `webpack` key is an error rather than a fallback, so
   * carrying both would have meant a configuration that silently stopped
   * applying the moment the default changed.
   */
  turbopack: {
    resolveAlias: {
      'pino-pretty': { browser: 'next/dist/compiled/empty-module' },
      lokijs: { browser: 'next/dist/compiled/empty-module' },
      encoding: { browser: 'next/dist/compiled/empty-module' },
    },
  },

  // ESLint is run by `yarn lint` and not by the build. Next 16 removed the
  // `eslint` config key along with `next lint`, so this is no longer a choice the
  // build offers — which is the arrangement the project wanted anyway: a style
  // complaint should never block a build that is otherwise correct.
};

export default nextConfig;
