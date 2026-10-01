'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  applySlippage,
  describeError,
  formatAmount,
  formatBps,
  formatSettlement,
  parseAmountInput,
  useBasketBalance,
  usePosition,
  useRedeem,
  useRedeemQuote,
  useTokenBalance,
} from '@thematic/blockchain';
import type { Basket, TokenMetadata } from '@thematic/types';
import { AmountField } from '@/components/ui/field.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { TransactionStatusPanel } from '@/components/transactions/transaction-status.tsx';
import { MockDataNotice, Notice } from '@/components/ui/notice.tsx';

/**
 * Redeeming a position (§11).
 *
 * The counterpart to the deposit dialog, and stricter in one respect: there is
 * no such thing here as a redemption with no floor.
 *
 * A redemption sends basket tokens to the contract and receives the settlement
 * asset back. The amount received is a function of prices that can move between
 * the quote and the block, so the transaction carries a minimum and reverts if
 * it cannot be met. A version of this dialog that sent `minSettlementOut = 0` —
 * the common shortcut — would let anyone who can move the price take the
 * difference, and the user's only signal would be that they received less than
 * they expected (§11).
 *
 * The other guard is at the bottom of this file: a redemption that would pay out
 * nothing is refused here rather than mined as a fee-only transaction that burns
 * the user's tokens for dust.
 */
export function WithdrawModal({
  open,
  onClose,
  basket,
  settlement,
}: {
  open: boolean;
  onClose: () => void;
  basket: Basket;
  settlement: TokenMetadata;
}) {
  const { address: account } = useAccount();

  const [input, setInput] = useState('');

  const { data: balance } = useBasketBalance(basket.address);
  const position = usePosition(basket.address);
  const { data: settlementBalance } = useTokenBalance(settlement.address);

  const shares = useMemo(() => parseAmountInput(input, basket.decimals), [input, basket.decimals]);

  const quote = useRedeemQuote(basket.address, shares);
  const redeemCtl = useRedeem(basket.address, basket.fees.maxSlippageBps);

  const exceeds = shares !== null && balance !== undefined && shares > balance;
  const busy = redeemCtl.busy;

  useEffect(() => {
    if (!open) {
      setInput('');
      redeemCtl.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const quoteError = quote.error ? describeError(quote.error) : null;
  const minOut = quote.data
    ? applySlippage(quote.data.settlementOut, basket.fees.maxSlippageBps)
    : null;
  const zeroPayout = quote.data ? quote.data.settlementOut <= 0n : false;

  async function onRedeem() {
    if (!shares || !quote.data) return;
    await redeemCtl.redeem(shares, quote.data);
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={`Redeem ${basket.symbol}`}
      description={`Burns basket tokens and pays out ${settlement.symbol} at the current net asset value.`}
    >
      {!account ? (
        <p className="text-sm text-ink-muted">Connect a wallet to redeem.</p>
      ) : (
        <div className="space-y-5">
          <AmountField
            label={`Basket tokens to redeem`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0.00"
            disabled={busy}
            error={exceeds ? 'That is more than you hold.' : undefined}
            trailing={
              <button
                type="button"
                disabled={busy || !balance || balance === 0n}
                onClick={() =>
                  balance
                    ? setInput(
                        formatAmount(balance, basket.decimals, {
                          displayDecimals: basket.decimals,
                          minDecimals: 0,
                        }),
                      )
                    : undefined
                }
                className="text-xs font-medium text-accent hover:underline disabled:text-ink-faint disabled:no-underline"
              >
                Max {balance !== undefined ? formatAmount(balance, basket.decimals) : '—'}{' '}
                {basket.symbol}
              </button>
            }
          />

          {/* The position, not just the balance: this is what it is worth right
              now, which is the number the decision is actually about. */}
          {position.data && position.data.shares > 0n ? (
            <p className="text-xs text-ink-muted">
              Your position: {formatAmount(position.data.shares, basket.decimals)} {basket.symbol},
              worth{' '}
              <span className="figure text-ink">
                {formatSettlement(position.data.value, settlement.decimals, settlement.symbol)}
              </span>{' '}
              at the current net asset value.
            </p>
          ) : null}

          <div className="rounded border border-rule bg-sunken px-4 py-3">
            {quoteError ? (
              <p className="text-sm text-warning">{quoteError.detail}</p>
            ) : quote.isLoading && shares ? (
              <p className="text-sm text-ink-muted">Reading a redemption price…</p>
            ) : quote.data ? (
              <dl className="space-y-2 text-sm">
                <QuoteRow
                  label="You receive"
                  value={formatSettlement(
                    quote.data.settlementOut,
                    settlement.decimals,
                    settlement.symbol,
                    {
                      displayDecimals: 4,
                      minDecimals: 2,
                    },
                  )}
                  strong
                />
                <QuoteRow
                  label="Redemption fee"
                  value={`− ${formatSettlement(quote.data.fee, settlement.decimals, settlement.symbol, { displayDecimals: 4, minDecimals: 2 })}`}
                />
                <QuoteRow
                  label="Gross value"
                  value={formatSettlement(quote.data.gross, settlement.decimals, settlement.symbol)}
                />
                {minOut !== null ? (
                  <QuoteRow
                    label={`Minimum you will accept (${formatBps(basket.fees.maxSlippageBps)} slippage)`}
                    value={formatSettlement(minOut, settlement.decimals, settlement.symbol, {
                      displayDecimals: 4,
                      minDecimals: 2,
                    })}
                    muted
                  />
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">
                Enter an amount to see what it would pay out.
              </p>
            )}
          </div>

          {/* The zero-payout guard, stated before it is enforced. The contract
              refuses this too; saying so here means the user does not pay gas to
              find out. */}
          {zeroPayout ? (
            <Notice tone="warning" title="This redemption would pay out nothing">
              At current prices the fee on this redemption would consume the entire payout. Nothing
              has been sent and your tokens are untouched — redeem a larger amount, or wait for the
              basket to be worth more.
            </Notice>
          ) : null}

          <MockDataNotice subject="The redemption value shown here" compact />

          <TransactionStatusPanel
            state={redeemCtl.state}
            onRetry={() => void onRedeem()}
            onDismiss={() => redeemCtl.reset()}
            retryLabel="Try the redemption again"
          />

          {redeemCtl.succeeded ? (
            <p className="text-sm text-ink-muted">
              {settlement.symbol} has been paid to your wallet
              {settlementBalance !== undefined
                ? `, which now holds ${formatSettlement(settlementBalance, settlement.decimals, settlement.symbol, { displayDecimals: 2, minDecimals: 2 })}`
                : ''}
              .
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose} disabled={busy} className="sm:flex-1">
              {redeemCtl.succeeded ? 'Close' : 'Cancel'}
            </Button>

            <Button
              variant="primary"
              size="md"
              className="sm:flex-[2]"
              busy={redeemCtl.busy}
              disabled={!shares || exceeds || zeroPayout || !quote.data || busy}
              onClick={() => void onRedeem()}
            >
              {exceeds
                ? 'More than you hold'
                : zeroPayout
                  ? 'Pays out nothing'
                  : quote.data && shares
                    ? `Redeem for ${formatSettlement(quote.data.settlementOut, settlement.decimals, settlement.symbol, { displayDecimals: 2, minDecimals: 2 })}`
                    : 'Redeem'}
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-ink-faint">
            Redemption is final. Once this transaction is confirmed the basket tokens are burned and
            cannot be recovered, and the amount you receive cannot exceed the minimum above by less
            than it states.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function QuoteRow({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={muted ? 'text-xs text-ink-faint' : 'text-ink-muted'}>{label}</dt>
      <dd>
        <span
          className={`figure ${strong ? 'text-ink' : muted ? 'text-xs text-ink-muted' : 'text-ink-muted'}`}
        >
          {value}
        </span>
      </dd>
    </div>
  );
}
