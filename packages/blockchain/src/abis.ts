/**
 * Contract ABIs, re-exported from the contracts package.
 *
 * The ABIs are generated from the compiled artifacts by
 * `yarn workspace @thematic/contracts export:abi`, and a check task fails the
 * build if they drift from what is compiled. Nothing here re-declares an ABI by
 * hand: a hand-copied ABI is a second source of truth, and the two only ever
 * disagree in the direction that costs someone their transaction.
 */
export {
  basketFactoryAbi,
  erc20Abi,
  mockPriceProviderAbi,
  priceProviderAbi,
  thematicBasketAbi,
} from '@thematic/contracts/abis';
