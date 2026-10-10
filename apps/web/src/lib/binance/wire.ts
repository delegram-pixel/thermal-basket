import type { ReferencePrice, UnderlyingProfile } from './rwa.ts';

/**
 * The shapes that cross the network between the Route Handlers and the browser.
 *
 * These are not the API's shapes. They are this application's own, and they exist
 * so that whatever the Binance Web3 API returns — including a shape nobody
 * anticipated — is flattened by the server before a component ever sees it. A
 * component that has to know the API's envelope is a component that breaks when
 * the envelope changes.
 */

export interface ReferenceFeedError {
  reason: 'unconfigured' | 'unreachable' | 'rejected' | 'malformed';
  status: number;
  /** The API's own error code, kept verbatim. `40103` and `40102` are the ones
   *  worth recognising, and neither survives being paraphrased. */
  code?: string;
  message: string;
}

export interface ReferenceFeed {
  source: 'binance-web3';
  chainId: number;
  fetchedAt: string;
  prices: ReferencePrice[];
  /**
   * How many listings one `/tokens` call returned, or `null` when that call did
   * not answer.
   *
   * Not the size of the API's catalogue: whether `/tokens` paginates has not been
   * established, and a page size presented as a total would be a fact about this
   * request wearing the label of a fact about the market.
   *
   * It is here to answer the question the reference column raises on its own:
   * a ticker with no price could be a ticker the API does not carry, or a price
   * call that failed. A listing count distinguishes "this component has no
   * listed counterpart" from "the API was unreachable", which is the difference
   * between a fact about the market and a fact about this deployment.
   */
  listed: number | null;
  error?: ReferenceFeedError;
}

export interface ProfileFeed {
  source: 'binance-web3';
  fetchedAt: string;
  profile: UnderlyingProfile | null;
  error?: ReferenceFeedError;
}

/** One endpoint's result in the diagnostics panel. */
export interface HealthProbe {
  endpoint: string;
  ok: boolean;
  status: number;
  ms: number;
  code?: string;
  message?: string;
  /** A short, non-sensitive excerpt of the body, so a shape can be read off it. */
  sample?: string;
}

export interface HealthReport {
  source: 'binance-web3';
  fetchedAt: string;
  /** False when no credentials are configured, which is not a failure. */
  configured: boolean;
  probes: HealthProbe[];
}
