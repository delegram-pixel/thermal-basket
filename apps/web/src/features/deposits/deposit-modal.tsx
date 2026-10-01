'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import {
  applySlippage,
  describeError,
  formatAmount,
  formatBps,
  parseAmountInput,
  useAllowance,
  useApproveToken,
  useDeposit,
  useDepositQuote,
  useTokenBalance,
} from '@thematic/blockchain';
import type { Basket, TokenMetadata } from '@thematic/types';
import { AmountField } from '@/components/ui/field.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { TransactionStatusPanel } from '@/components/transactions/transaction-status.tsx';
import { MockDataNotice } from '@/components/ui/notice.tsx';

/**
 * Investing in a basket (§9, §21).
 *
 * The dialog's job is to make the trade legible before it is signed. That means
 * four figures, all of them from the contract rather than computed here:
 *
 * - how much is going in,
 * - the fee being charged and who receives it,
 * - what is actually invested,
 * - and the *floor* — the fewest basket tokens this transaction will accept.
 *
 * The floor is the number that matters most and the one a typical dApp hides.
 * It is the quoted output reduced by the basket's own slippage tolerance, and it
 * is the value the contract reverts against. Showing it turns an invisible
 * protection into a stated promise: either you get at least this, or the
 * transaction fails and costs you gas and nothing else (§11).
 */
export function DepositModal({
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
  const chainId = useChainId();

  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<'input' | 'approving' | 'depositing'>('input');

  const amount = useMemo(
    () => parseAmountInput(input, settlement.decimals),
    [input, settlement.decimals],
  );

  const { data: balance } = useTokenBalance(settlement.address);
  const { data: allowance } = useAllowance(settlement.address, basket.address);
  const quote = useDepositQuote(basket.address, amount);

  const approveCtl = useApproveToken();
  const depositCtl = useDeposit(basket.address, basket.fees.maxSlippageBps);

  const approved = allowance !== undefined && amount !== null && allowance >= amount;
  const insufficient = amount !== null && balance !== undefined && amount > balance;
  const busy = approveCtl.busy || depositCtl.busy;

  // Close the loop: once the deposit confirms, clear the form so reopening the
  // dialog does not offer to repeat the transaction that was just made.
  useEffect(() => {
    if (depositCtl.succeeded) {
      setInput('');
      setPhase('input');
    }
  }, [depositCtl.succeeded]);

  useEffect(() => {
    if (!open) {
      setInput('');
      setPhase('input');
      approveCtl.reset();
      depositCtl.reset();
    }
    // Deliberately keyed on `open` alone: resetting on every controller change
    // would wipe the form mid-transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const slippageBps = basket.fees.maxSlippageBps;
  const minSharesOut = quote.data ? applySlippage(quote.data.sharesOut, slippageBps) : null;

  // A quote that reverted is a state to explain, not an exception to swallow.
  const quoteError = quote.error ? describeError(quote.error) : null;

  async function onApprove() {
    if (!amount) return;
    setPhase('approving');
    const hash = await approveCtl.approve(settlement.address, basket.address, amount);
    if (hash) setPhase('input');
  }

  async function onDeposit() {
    if (!amount || !quote.data) return;
    setPhase('depositing');
    await depositCtl.deposit(amount, quote.data);
    setPhase('input');
  }

  const activeState = phase === 'approving' ? approveCtl.state : depositCtl.state;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={`Invest in ${basket.symbol}`}
      description={`Your ${settlement.symbol} is converted into basket tokens at the current net asset value.`}
    >
      {!account ? (
        <p className="text-sm text-ink-muted">Connect a wallet to invest.</p>
      ) : (
        <div className="space-y-5">
          <AmountField
            label={`Amount in ${settlement.symbol}`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0.00"
            disabled={busy}
            error={
              insufficient
                ? `You hold ${formatAmount(balance ?? 0n, settlement.decimals)} ${settlement.symbol}.`
                : undefined
            }
            trailing={
              <button
                type="button"
                disabled={busy || !balance || balance === 0n}
                onClick={() =>
                  balance
                    ? setInput(
                        formatAmount(balance, settlement.decimals, {
                          displayDecimals: settlement.decimals,
                          minDecimals: 0,
                        }),
                      )
                    : undefined
                }
                className="text-xs font-medium text-accent hover:underline disabled:text-ink-faint disabled:no-underline"
              >
                Balance {balance !== undefined ? formatAmount(balance, settlement.decimals) : '—'}{' '}
                {settlement.symbol}
              </button>
            }
          />

          {/* -- The quote -------------------------------------------------- */}
          <div className="rounded border border-rule bg-sunken px-4 py-3">
            {quoteError ? (
              <p className="text-sm text-warning">{quoteError.detail}</p>
            ) : quote.isLoading && amount ? (
              <p className="text-sm text-ink-muted">Reading a price for this deposit…</p>
            ) : quote.data ? (
              <dl className="space-y-2 text-sm">
                <QuoteRow
                  label="You receive"
                  value={`${formatAmount(quote.data.sharesOut, basket.decimals)} ${basket.symbol}`}
                  strong
                />
                <QuoteRow
                  label="Deposit fee"
                  value={`− ${formatAmount(quote.data.fee, settlement.decimals, { displayDecimals: 4, minDecimals: 2 })} ${settlement.symbol}`}
                />
                <QuoteRow
                  label="Invested"
                  value={`${formatAmount(quote.data.netInvested, settlement.decimals)} ${settlement.symbol}`}
                />
                {minSharesOut !== null ? (
                  <QuoteRow
                    label={`Minimum you will accept (${formatBps(slippageBps)} slippage)`}
                    value={`${formatAmount(minSharesOut, basket.decimals)} ${basket.symbol}`}
                    muted
                  />
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">Enter an amount to see what it would buy.</p>
            )}
          </div>

          <MockDataNotice subject="The price and the tokens this deposit would buy" compact />

          {/* -- Authority --------------------------------------------------- */}
          {!approved && amount && quote.data ? (
            <p className="text-xs leading-relaxed text-ink-faint">
              First, approve {settlement.symbol} for this basket. The approval is for exactly this
              amount — not unlimited — so no standing permission is left behind after the deposit.
            </p>
          ) : null}

          <TransactionStatusPanel
            state={activeState}
            onRetry={phase === 'approving' ? () => void onApprove() : () => void onDeposit()}
            onDismiss={() => {
              approveCtl.reset();
              depositCtl.reset();
            }}
            retryLabel={phase === 'approving' ? 'Approve again' : 'Try the deposit again'}
          />

          {/* -- Action ------------------------------------------------------ */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose} disabled={busy} className="sm:flex-1">
              Cancel
            </Button>

            {approved || !amount || !quote.data ? (
              <Button
                variant="primary"
                size="md"
                className="sm:flex-[2]"
                busy={depositCtl.busy}
                disabled={!amount || insufficient || !quote.data || busy}
                onClick={() => void onDeposit()}
              >
                {insufficient
                  ? 'Not enough balance'
                  : quote.data && amount
                    ? `Invest ${formatAmount(amount, settlement.decimals, { displayDecimals: settlement.decimals, minDecimals: 2 })} ${settlement.symbol}`
                    : 'Invest'}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                className="sm:flex-[2]"
                busy={approveCtl.busy}
                disabled={busy}
                onClick={() => void onApprove()}
              >
                Approve {settlement.symbol}
              </Button>
            )}
          </div>

          <p className="text-xs leading-relaxed text-ink-faint">
            Your basket tokens are minted only if the price holds within your slippage tolerance. If
            it moves further than that, the transaction fails and you pay gas and nothing else.
            Submitted on chain {chainId}.
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
