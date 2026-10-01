/**
 * `@thematic/blockchain` — everything between the contracts and the interface.
 *
 * Three layers, deliberately separate:
 *
 * - `abis` and `reads` hold no React. They take a viem client and return domain
 *   objects, so they run in a server component, a hook, a script or a test.
 * - `hooks` and `writes` add caching and wallet context on top.
 * - `format` and `errors` are the edge: the only places an amount becomes text
 *   or a revert becomes a sentence.
 *
 * Two conventions are enforced throughout and worth stating where someone will
 * read them first:
 *
 * 1. **Basis points, never percentages.** 3500 is 35%.
 * 2. **Amounts are `bigint` in the token's smallest unit**, until `format`
 *    turns one into a string.
 */

export {
  basketFactoryAbi,
  erc20Abi,
  mockPriceProviderAbi,
  priceProviderAbi,
  thematicBasketAbi,
} from './abis.ts';

export {
  BASKET_TOKEN_DECIMALS,
  formatAmount,
  formatBps,
  formatNavPerShare,
  formatRelativeTime,
  formatSettlement,
  formatWeight,
  parseAmountInput,
  ratioBps,
  shortenAddress,
  type FormatAmountOptions,
} from './format.ts';

export { describeError, isUserRejection, type FriendlyError } from './errors.ts';

export { chunk, mapLimit, settle, sum } from './utils.ts';

export { getPublicClient, wagmiConfig, type WagmiConfig } from './client.ts';

export {
  previewDeposit,
  previewRedeem,
  readAllowance,
  readBalance,
  readBasket,
  readBasketAddresses,
  readBasketBalances,
  readBasketFees,
  readBasketSummaries,
  readBasketSummary,
  readComponentAllowlist,
  readCreatorBaskets,
  readCreatorEarnings,
  readFactoryConfig,
  readPosition,
  readTokenMetadata,
  readTokenPrices,
  type CreationTerms,
  type DepositQuote,
  type FactoryConfig,
  type RedeemQuote,
} from './reads.ts';

export {
  queryKeys,
  useAddressBook,
  useAllowance,
  useBasket,
  useBasketBalance,
  useBasketBalances,
  useBasketList,
  useComponentAllowlist,
  useCreatorBaskets,
  useCreatorEarnings,
  useDepositQuote,
  useFactoryConfig,
  useIsMockEnvironment,
  usePosition,
  useRedeemQuote,
  useTokenBalance,
  useTokenMetadata,
  useTokenMetadataList,
  useTokenPrices,
} from './hooks.ts';

export {
  applySlippage,
  useApproveToken,
  useClaimCreatorFees,
  useCreateBasket,
  useDeposit,
  useRedeem,
  useTransactionController,
  type CreateBasketInput,
  type TransactionController,
} from './writes.ts';
