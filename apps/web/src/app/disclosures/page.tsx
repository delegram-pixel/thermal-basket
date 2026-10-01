'use client';

import Link from 'next/link';
import { useChainId } from 'wagmi';
import { getChain, isMockEnvironment, isSupportedChain, publicEnv } from '@thematic/config';
import { useAddressBook, useFactoryConfig } from '@thematic/blockchain';
import { BPS_DENOMINATOR, type Address } from '@thematic/types';
import { Container, Section, SectionHeading } from '@/components/ui/layout.tsx';
import { Notice } from '@/components/ui/notice.tsx';
import { AddressChip } from '@/components/ui/address.tsx';

/**
 * Disclosures.
 *
 * This is the page every other page points at when it has to qualify a figure.
 * Two things bring a reader here: the "simulated market data" notice next to a
 * price, and the risk paragraph in the footer. So the page answers, in order:
 * what on this deployment is real, what the fees actually do to your money, and
 * what can go wrong.
 *
 * It is written to be read by someone deciding whether to deposit, not to be
 * skimmed past on the way to a button. The deployment facts are read live rather
 * than described, because a disclosure that quietly stops matching the contracts
 * it describes is worse than none: it is a false assurance.
 */
export default function DisclosuresPage() {
  const chainId = useChainId();
  const config = useFactoryConfig();
  const book = useAddressBook();

  const mock = isMockEnvironment(chainId);
  const chainName = isSupportedChain(chainId)
    ? getChain(chainId).name
    : `an unsupported network (${chainId})`;

  return (
    <>
      <Section className="pt-12 pb-8 sm:pt-16">
        <Container width="prose">
          <p className="label">Before you deposit anything</p>
          <h1 className="mt-3 text-[2rem] leading-tight sm:text-[2.5rem]">
            What this deployment is, and what it is not
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-muted">
            Thematic is an MVP: a working set of smart contracts with a real test suite, built for a
            hackathon and deployed to a test network. Everything the contracts do, they really do.
            What they operate on is, on this deployment, a simulation.
          </p>
        </Container>
      </Section>

      {/* -- What is real --------------------------------------------------- */}
      <Section id="mock" divided>
        <Container width="prose">
          <SectionHeading
            title="What is simulated, and what is not"
            description="The distinction matters more than any disclaimer, so it is drawn precisely."
          />

          {mock ? (
            <Notice
              tone="warning"
              title={`You are connected to ${chainName}, which is a mock environment`}
              className="mb-8"
            >
              The price feed on this network is a contract deployed by this project that returns
              fixed and arbitrarily moving numbers. It does not read any market, it does not track
              any real security, and no number that comes from it is a quotation. Treat every price,
              valuation and net asset value you see here as an exercise in arithmetic.
            </Notice>
          ) : (
            <Notice tone="info" title={`You are connected to ${chainName}`} className="mb-8">
              Prices on this network come from an external feed configured by whoever deployed it.
              This application does not verify that feed, and a feed is not a market — it is one
              source&rsquo;s opinion, and it can be wrong, stale, or manipulated.
            </Notice>
          )}

          <div className="space-y-8">
            <Disclosure
              title="Real"
              tone="positive"
              items={[
                'The basket contracts. Deposits, redemptions, minting, burning and fee accounting all execute on-chain exactly as written, and every state change is a transaction you signed.',
                'The ERC-20 tokens. Basket tokens are real ERC-20s with real balances; you can transfer them, and nobody but you can move them.',
                'The custody. Component holdings sit in the basket contract, not with this project, the creator, or any server. There is no off-chain ledger anywhere in the system.',
                'The fees. Deposit and redemption fees are taken by the contract at the rate stored in it, and the split between creator and protocol is enforced on-chain.',
                'The composition. The weights published on a basket page are read from the contract. They cannot be edited after creation by anyone.',
              ]}
            />

            <Disclosure
              title="Simulated on this deployment"
              tone="warning"
              items={[
                'The component tokens. On a test network these are mock ERC-20s deployed by this project. Holding a mock NVDA gives you no economic interest in NVIDIA, no shareholder right, and no claim on anything.',
                'The prices. A mock provider returns numbers for each mock token. They are not quotations, they do not follow any real price, and they can be set to anything by whoever deployed the provider.',
                'The exchange. Deposits and redemptions are filled by a mock adapter that moves tokens at the prices above. On a chain with real liquidity this is where an actual swap would happen, and it is where slippage and MEV would live.',
              ]}
            />

            <Disclosure
              title="Not implemented at all"
              tone="neutral"
              items={[
                'Rebalancing. A basket keeps whatever it bought. When prices move, the realised composition drifts away from the published weights, and nothing brings it back. Both figures are shown on every basket page so the gap is visible rather than inferred.',
                'Yield, staking or lending. Nothing here generates a return. A basket’s value moves only because its components move.',
                'Dividends. If a tokenized equity pays one, this system has no mechanism to collect or distribute it.',
                'Voting or any other shareholder right. A basket token conveys nothing except a claim on the basket’s assets through redemption.',
              ]}
            />
          </div>

          <div className="mt-10 border-t border-rule pt-5">
            <p className="label">This deployment</p>
            <dl className="mt-3 space-y-3 text-sm">
              <DeploymentRow label="Connected network" value={chainName} />
              <DeploymentRow label="This build targets" value={getChain(publicEnv.chainId).name} />
              <DeploymentRow
                label="Prices"
                value={mock ? 'Simulated' : 'External feed'}
                tone={mock ? 'warning' : undefined}
              />
              <DeploymentRow label="Settlement asset" value={config.data?.settlementToken.symbol} />
              {book ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <dt className="text-ink-muted">Factory contract</dt>
                  <dd>
                    <AddressChip address={book.factory as Address} visible={6} />
                  </dd>
                </div>
              ) : null}
              {book ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <dt className="text-ink-muted">Price provider</dt>
                  <dd>
                    <AddressChip address={book.priceProvider as Address} visible={6} />
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Addresses are read from the running configuration. If they disagree with what you see
              in a block explorer, the explorer is right and this page is stale.
            </p>
          </div>
        </Container>
      </Section>

      {/* -- Fees ------------------------------------------------------------ */}
      <Section id="fees" divided>
        <Container width="prose">
          <SectionHeading
            title="How fees work"
            description="Two charges, both taken by the contract, both set at creation and immutable afterwards."
          />

          <div className="space-y-5 text-sm leading-relaxed text-ink-muted">
            <p>
              <strong className="font-semibold text-ink">The deposit fee</strong> is taken from what
              you put in, before anything is bought. Deposit{' '}
              {config.data ? `${(config.data.defaults.depositFeeBps / 100).toFixed(2)}%` : 'a fee'}{' '}
              and the remainder is spread across the components. The fee does not reduce your number
              of basket tokens relative to the others — every holder’s tokens represent the same net
              asset value — it reduces the value of the whole basket by the amount of the fee.
            </p>

            <p>
              <strong className="font-semibold text-ink">The redemption fee</strong> is taken from
              the proceeds when you redeem, before they reach your wallet. The contract refuses a
              redemption whose fee would consume the entire payout rather than burning your tokens
              for nothing.
            </p>

            <p>
              <strong className="font-semibold text-ink">Both fees are split</strong> between the
              basket’s creator and the protocol, at a ratio fixed when the basket was created.
              {config.data
                ? ` The defaults are ${(config.data.defaults.creatorShareBps / 100).toFixed(0)}% to the creator and ${((BPS_DENOMINATOR - config.data.defaults.creatorShareBps) / 100).toFixed(0)}% to the protocol, and an individual basket may differ within protocol limits.`
                : ''}{' '}
              The creator’s share is not paid out automatically; it accrues in the basket contract
              until the creator claims it.
            </p>

            <p>
              <strong className="font-semibold text-ink">
                There is a third cost that is not a fee.
              </strong>{' '}
              Deposits and redemptions carry a slippage tolerance. The transaction reverts if the
              price moves against it by more than the tolerance between the quote and the block, so
              you cannot be filled at a materially worse price than the one you were shown — but on
              a volatile asset the deposit may simply fail, and a failed transaction still costs
              gas.
            </p>
          </div>

          {config.data ? (
            <div className="mt-8 border-t border-ink pt-4">
              <p className="label">The protocol’s current defaults</p>
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-rule border-b border-rule">
                  <FeeRow label="Deposit fee" bps={config.data.defaults.depositFeeBps} />
                  <FeeRow label="Redemption fee" bps={config.data.defaults.redeemFeeBps} />
                  <FeeRow
                    label="Creator share of each fee"
                    bps={config.data.defaults.creatorShareBps}
                  />
                  <FeeRow label="Slippage tolerance" bps={config.data.defaults.maxSlippageBps} />
                </tbody>
              </table>
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                Read from the factory contract. These are the values a new basket inherits; a basket
                already deployed keeps its own, which are printed on its page.
              </p>
            </div>
          ) : null}
        </Container>
      </Section>

      {/* -- Risk ------------------------------------------------------------ */}
      <Section divided className="pb-20">
        <Container width="prose">
          <SectionHeading
            title="What can go wrong"
            description="The specific failure modes, not a general warning that risk exists."
          />

          <div className="space-y-5 text-sm leading-relaxed text-ink-muted">
            <p>
              <strong className="font-semibold text-ink">You can lose money.</strong> A basket holds
              assets that can fall in value, and a concentrated basket falls harder than the market
              it is drawn from. Nothing in this system is designed to preserve capital, and no
              composition offered here has been reviewed by anyone for suitability. Providing a
              creation tool is not a recommendation of what anyone creates with it.
            </p>

            <p>
              <strong className="font-semibold text-ink">The contracts are unaudited.</strong> They
              have a test suite that covers the economic paths, and a passing test suite is not a
              security review. Assume there are bugs, including ones that could cost you your
              deposit. Do not put in more than you are willing to lose entirely.
            </p>

            <p>
              <strong className="font-semibold text-ink">
                The creator chooses the composition, and a bad one is not fraud.
              </strong>{' '}
              A basket can be concentrated, incoherent, or built around a thesis that does not
              survive contact with the market. A creator cannot take your money — they have no
              access to the basket’s holdings and cannot mint tokens — but they can publish
              something you would not have chosen.
            </p>

            <p>
              <strong className="font-semibold text-ink">
                A creator can pause deposits and redemptions.
              </strong>{' '}
              Pausing stops new deposits and new redemptions. It does not touch your tokens and it
              cannot move the basket’s assets, but if a basket is paused you may be unable to redeem
              until it is unpaused. This is a real, unilateral power over your ability to exit.
            </p>

            <p>
              <strong className="font-semibold text-ink">A price feed can fail or lie.</strong> If a
              component cannot be priced, deposits and redemptions revert rather than executing at a
              wrong number. That is the intended behaviour, and it means a broken feed makes a
              basket unusable rather than merely mispriced. A feed that reports a
              wrong-but-plausible number is the harder case, and this system cannot detect it: a
              deposit priced off a bad feed is filled at a bad price, and the transaction is final.
            </p>

            <p>
              <strong className="font-semibold text-ink">
                Blockchain transactions are irreversible.
              </strong>{' '}
              Once a deposit or a redemption is confirmed in a block, no one — not this application,
              not the creator, not the protocol administrator — can undo it. There is no support
              process that can return funds, because there is no custodian holding them.
            </p>

            <p>
              <strong className="font-semibold text-ink">This application can be wrong.</strong> It
              reads the contracts and displays what it reads. If it displays something incorrectly,
              the contracts still hold what they hold and the transaction still does what it does.
              The chain is authoritative; this page is a rendering of it.
            </p>

            <p>
              <strong className="font-semibold text-ink">
                Nothing here is investment advice, and nothing here is a projection.
              </strong>{' '}
              No composition on this site has been assessed for suitability for anyone. No figure
              shown is a forecast, and past movement of any composition is not a guide to its
              future.
            </p>
          </div>

          <div className="mt-10 border-t border-rule pt-6">
            <p className="text-sm text-ink-muted">
              Read the composition and the fee schedule on a basket’s own page before depositing
              into it. Both are read from the contract that will hold your money, and both are the
              whole of what you are agreeing to.
            </p>
            <Link
              href="/baskets"
              className="mt-4 inline-flex h-11 items-center justify-center rounded border border-rule-strong px-5 text-sm font-medium text-ink transition-colors hover:bg-sunken"
            >
              Look at a basket
            </Link>
          </div>
        </Container>
      </Section>
    </>
  );
}

/**
 * A block of the real/simulated/absent ledger.
 *
 * `tone` colours the heading rule only. The list itself is plain text, because a
 * wall of coloured bullets reads as decoration and stops being read as content.
 */
function Disclosure({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'positive' | 'warning' | 'neutral';
}) {
  const rule = {
    positive: 'border-positive',
    warning: 'border-warning',
    neutral: 'border-rule-strong',
  }[tone];

  return (
    <div className={`border-t-2 ${rule} pt-4`}>
      <h2 className="font-display text-xl text-ink">{title}</h2>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li
            key={item}
            className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2 text-sm leading-relaxed text-ink-muted"
          >
            <span aria-hidden="true" className="mt-2 block h-px w-2 bg-rule-strong" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeploymentRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | undefined;
  tone?: 'warning';
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={tone === 'warning' ? 'text-warning' : 'text-ink'}>{value ?? '—'}</dd>
    </div>
  );
}

function FeeRow({ label, bps }: { label: string; bps: number }) {
  return (
    <tr>
      <th scope="row" className="py-2.5 text-left font-normal text-ink-muted">
        {label}
      </th>
      <td className="py-2.5 text-right">
        <span className="figure text-ink">{(bps / 100).toFixed(2)}%</span>
        <span className="figure ml-2 text-xs text-ink-faint">{bps} bps</span>
      </td>
    </tr>
  );
}
