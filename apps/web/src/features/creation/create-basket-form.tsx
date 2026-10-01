'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { decodeEventLog } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import {
  basketFactoryAbi,
  formatSettlement,
  formatWeight,
  useAddressBook,
  useCreateBasket,
  useFactoryConfig,
  type CreateBasketInput,
} from '@thematic/blockchain';
import { BPS_DENOMINATOR, type Address } from '@thematic/types';
import {
  AmountField,
  FieldGroup,
  TextArea,
  TextField,
  controlClass,
} from '@/components/ui/field.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Container } from '@/components/ui/layout.tsx';
import { AddressChip } from '@/components/ui/address.tsx';
import { EmptyState, ErrorState, LoadingState, RiskMark } from '@/components/ui/states.tsx';
import { MockDataNotice, Notice } from '@/components/ui/notice.tsx';
import { TransactionStatusPanel } from '@/components/transactions/transaction-status.tsx';
import { BasketAllocation } from '@/components/baskets/basket-allocation.tsx';
import { useComponentCatalog } from '@/features/baskets/use-component-catalog.ts';
import {
  addComponent,
  bpsToPercent,
  checkDraft,
  emptyDraft,
  percentToBps,
  redistribute,
  removeComponent,
  type BasketDraft,
} from './draft.ts';

/**
 * Creating a basket (§23).
 *
 * Five steps, but not a wizard that hides things. Two decisions shape it:
 *
 * 1. **The preview never leaves the screen.** A composition is a proportional
 *    thing, and the only way to judge a set of weights is to see them drawn. The
 *    band on the right updates on every keystroke, so the effect of changing 30
 *    to 35 is visible rather than imagined. It is sticky on a wide screen and
 *    sits above the fields on a narrow one, because a preview below the fold is
 *    a preview nobody sees.
 *
 * 2. **Steps exist to order the work, not to gate it.** Every step's content is
 *    reachable from the step strip, and a step that is not yet valid states what
 *    is missing instead of silently refusing to advance.
 *
 * The last panel is the one that matters. A creator is about to deploy something
 * immutable — no edit, no update, no admin override — so the review step says so
 * plainly and in those words, and the deploy button only exists at the end.
 */

const STEPS = [
  { key: 'identity', label: 'Identity', hint: 'Name, symbol and theme' },
  { key: 'composition', label: 'Composition', hint: 'What it holds, and how much of each' },
  { key: 'fees', label: 'Fees', hint: 'What depositors pay and what you keep' },
  { key: 'review', label: 'Review', hint: 'Read it once before it is permanent' },
  { key: 'deploy', label: 'Deploy', hint: 'One transaction' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

export function CreateBasketForm() {
  const config = useFactoryConfig();
  const catalog = useComponentCatalog();
  const book = useAddressBook();
  const create = useCreateBasket(book?.factory);

  const [step, setStep] = useState<StepKey>('identity');
  const [draft, setDraft] = useState<BasketDraft | null>(null);
  const [createdBasket, setCreatedBasket] = useState<Address | null>(null);
  // Declared here with the rest, and not down beside the helpers that use it:
  // this component returns early for a missing config or address book, and a
  // hook declared after one of those returns is a hook that does not run on
  // every render.
  const [revealed, setRevealed] = useState<ReadonlySet<StepKey>>(new Set());

  /**
   * The draft is seeded once the factory's defaults are known.
   *
   * Seeded rather than initialised empty because the fee fields should arrive
   * pre-filled with the deployment's advisory defaults: leaving them blank makes
   * a creator invent numbers for a decision they may not have an opinion about,
   * and blank fee fields invite someone to type 0 by accident.
   */
  useEffect(() => {
    if (config.data && draft === null) {
      setDraft(emptyDraft(config.data.defaults));
    }
  }, [config.data, draft]);

  /**
   * The hash of the deployment transaction, watched for its receipt.
   *
   * The factory returns the new basket's address from `createBasket`, but the
   * return value of a state-changing call is not visible to the caller — it is
   * in the receipt's logs. Reading it back is what lets this page hand the
   * creator a link to the thing they just made instead of a bare transaction
   * hash.
   *
   * This watches the same hash the transaction controller already watches, so it
   * shares that query rather than issuing a second one; a form that decoded its
   * own receipt would otherwise be polling the node twice for one transaction.
   */
  const hash = create.state.hash;
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  useEffect(() => {
    if (!receipt.data || !book) return;

    for (const log of receipt.data.logs) {
      if (log.address.toLowerCase() !== book.factory.toLowerCase()) continue;

      try {
        // The event name is given rather than inferred. During a `createBasket`
        // call `BasketCreated` is the only event the factory emits, and naming it
        // means the decoded `args` are typed instead of a union to be narrowed —
        // and that a log which is somehow something else throws here rather than
        // being misread as a basket address.
        const decoded = decodeEventLog({
          abi: basketFactoryAbi,
          eventName: 'BasketCreated',
          data: log.data,
          topics: log.topics,
        });
        setCreatedBasket(decoded.args.basket);
        return;
      } catch {
        // Not the event we are looking for.
      }
    }
  }, [receipt.data, book]);

  if (config.isPending || (draft === null && config.isSuccess)) {
    return (
      <Container width="wide" className="py-16">
        <LoadingState message="Reading the factory's creation terms…" />
      </Container>
    );
  }

  if (config.isError || !config.data || draft === null) {
    return (
      <Container width="wide" className="py-16">
        <ErrorState
          title="The factory could not be read"
          detail="A basket's fee ceilings and defaults come from the factory contract, so nothing can be validated without it. Check that this build points at a deployed factory on the network your wallet is using."
          onRetry={() => void config.refetch()}
        />
      </Container>
    );
  }

  if (!book) {
    return (
      <Container width="wide" className="py-16">
        <EmptyState
          title="No factory is configured for this network"
          description="Creating a basket needs a deployed factory. This build has no address for one, so there is nothing to create in."
        />
      </Container>
    );
  }

  const check = checkDraft(draft, config.data.limits, config.data.maxComponents);
  const settlement = config.data.settlementToken;

  const stepIndex = STEPS.findIndex((entry) => entry.key === step);

  /** Which step's rules are satisfied. Drives both the strip and the footer. */
  const satisfied: Record<StepKey, boolean> = {
    identity: Object.keys(check.identity).length === 0,
    composition: Object.keys(check.composition).length === 0,
    fees: Object.keys(check.fees).length === 0,
    review: check.valid,
    deploy: create.succeeded,
  };

  function update(patch: Partial<BasketDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  /**
   * Which errors the creator has earned the right to see.
   *
   * `checkDraft` validates the draft as it stands, so on a fresh form every
   * required identity field is empty and therefore in error. Rendering that
   * straight away greets someone who has not started with three red complaints
   * about work they have not begun — which reads as the form being annoyed with
   * them rather than as guidance.
   *
   * So a step's errors are held back until the creator has left a field in that
   * step. That is the moment the corrections become useful: they have started
   * the step, they have told the form something, and the next thing they need is
   * to know what else it wants. Before that, silence.
   *
   * This governs what is *said*, not what is checked — the draft is validated in
   * full the whole time, and the deploy button is gated on the real result
   * either way.
   */
  const reveal = (key: StepKey) =>
    setRevealed((current) => (current.has(key) ? current : new Set(current).add(key)));

  const earned = <T extends object>(key: StepKey, errors: T): T =>
    revealed.has(key) ? errors : ({} as T);

  async function deploy() {
    if (!check.valid || !draft) return;

    const input: CreateBasketInput = {
      name: draft.name.trim(),
      symbol: draft.symbol.trim().toUpperCase(),
      description: draft.description.trim(),
      theme: draft.theme.trim(),
      components: draft.components,
      weightsBps: draft.components.map((address) => {
        const parsed = percentToBps(draft.weights[address.toLowerCase()] ?? '');
        return parsed.ok ? parsed.bps : 0;
      }),
      depositFeeBps: percentToBps(draft.depositFee).ok
        ? (percentToBps(draft.depositFee) as { bps: number }).bps
        : 0,
      redeemFeeBps: percentToBps(draft.redeemFee).ok
        ? (percentToBps(draft.redeemFee) as { bps: number }).bps
        : 0,
      creatorShareBps: percentToBps(draft.creatorShare).ok
        ? (percentToBps(draft.creatorShare) as { bps: number }).bps
        : 0,
      maxSlippageBps: percentToBps(draft.slippage).ok
        ? (percentToBps(draft.slippage) as { bps: number }).bps
        : 0,
    };

    await create.createBasket(input);
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-16">
      {/* -- The flow -------------------------------------------------------- */}
      <div className="min-w-0">
        <StepStrip current={step} satisfied={satisfied} onSelect={setStep} disabled={create.busy} />

        <div className="mt-8">
          {step === 'identity' ? (
            <IdentityStep
              draft={draft}
              errors={earned('identity', check.identity)}
              onBlurField={() => reveal('identity')}
              onChange={update}
              disabled={create.busy}
            />
          ) : null}

          {step === 'composition' ? (
            <CompositionStep
              draft={draft}
              // The composition errors are mostly about the weights not summing,
              // and "add at least one component" is the only one that makes sense
              // before anything has been added — so once there is a component to
              // be wrong about, all of them are worth saying.
              errors={
                revealed.has('composition') || draft.components.length > 0 ? check.composition : {}
              }
              totalBps={check.totalBps}
              maxComponents={config.data.maxComponents}
              settlementSymbol={settlement.symbol}
              settlementDecimals={settlement.decimals}
              catalog={catalog}
              onChange={update}
              disabled={create.busy}
            />
          ) : null}

          {step === 'fees' ? (
            <FeesStep
              draft={draft}
              errors={earned('fees', check.fees)}
              onBlurField={() => reveal('fees')}
              limits={config.data.limits}
              defaults={config.data.defaults}
              onChange={update}
              disabled={create.busy}
            />
          ) : null}

          {step === 'review' ? (
            <ReviewStep
              draft={draft}
              catalog={catalog}
              valid={check.valid}
              limits={config.data.limits}
              settlementSymbol={settlement.symbol}
              factory={book.factory}
            />
          ) : null}

          {step === 'deploy' ? (
            <DeployStep
              create={create}
              createdBasket={createdBasket}
              valid={check.valid}
              onDeploy={() => void deploy()}
            />
          ) : null}
        </div>

        {/* -- Step navigation ---------------------------------------------- */}
        {step !== 'deploy' ? (
          <div className="mt-10 flex items-center justify-between gap-3 border-t border-rule pt-6">
            <Button
              variant="ghost"
              disabled={stepIndex === 0 || create.busy}
              onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)]!.key)}
            >
              ← Back
            </Button>

            <Button
              variant="primary"
              disabled={!satisfied[step] || create.busy}
              onClick={() => {
                // Leaving a step is the moment its corrections become useful —
                // and the button is only enabled when the step is already
                // satisfied, so this only ever fires on a step with nothing
                // wrong with it. It is here so that a creator who is *stopped*
                // by a disabled button still gets the reason on the next visit.
                reveal(step);
                setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!.key);
              }}
            >
              {stepIndex === STEPS.length - 2 ? 'Review and deploy →' : 'Continue →'}
            </Button>
          </div>
        ) : null}

        {step !== 'deploy' && !satisfied[step] ? (
          <p className="mt-3 text-right text-xs text-ink-muted">
            Finish this step to continue. Nothing is deployed until the last one.
          </p>
        ) : null}
      </div>

      {/* -- The live preview ------------------------------------------------ */}
      <PreviewPanel draft={draft} totalBps={check.totalBps} catalog={catalog} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step strip
// ---------------------------------------------------------------------------

function StepStrip({
  current,
  satisfied,
  onSelect,
  disabled,
}: {
  current: StepKey;
  satisfied: Record<StepKey, boolean>;
  onSelect: (step: StepKey) => void;
  disabled: boolean;
}) {
  return (
    <nav aria-label="Creation steps">
      <ol className="flex flex-wrap gap-x-1 gap-y-2 border-b border-rule pb-3">
        {STEPS.map((entry, index) => {
          const active = entry.key === current;
          const done = satisfied[entry.key];

          return (
            <li key={entry.key}>
              <button
                type="button"
                disabled={disabled}
                aria-current={active ? 'step' : undefined}
                onClick={() => onSelect(entry.key)}
                className={[
                  'flex items-baseline gap-2 rounded px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-sunken text-ink'
                    : 'text-ink-muted hover:bg-sunken/70 hover:text-ink',
                  disabled ? 'cursor-not-allowed opacity-60' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="figure text-xs text-ink-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className={active ? 'font-medium' : ''}>{entry.label}</span>
                {/* A tick rather than a colour: which steps are done has to be
                    readable without distinguishing two greens. */}
                {done && !active ? (
                  <span aria-label="complete" className="text-positive">
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      {STEPS.find((entry) => entry.key === current) ? (
        <p className="mt-2.5 text-xs text-ink-muted">
          {STEPS.find((entry) => entry.key === current)!.hint}
        </p>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — identity
// ---------------------------------------------------------------------------

function IdentityStep({
  draft,
  errors,
  onBlurField,
  onChange,
  disabled,
}: {
  draft: BasketDraft;
  errors: { name?: string; symbol?: string; theme?: string; description?: string };
  /** Called when any field is left, so the step can stop holding its errors back. */
  onBlurField: () => void;
  onChange: (patch: Partial<BasketDraft>) => void;
  disabled: boolean;
}) {
  return (
    <FieldGroup
      legend="Identity"
      description="This is what appears in the explorer and on the basket's own page. None of it can be changed after deployment."
    >
      <TextField
        label="Name"
        required
        value={draft.name}
        error={errors.name}
        disabled={disabled}
        maxLength={64}
        placeholder="AI Infrastructure"
        onBlur={onBlurField}
        onChange={(event) => onChange({ name: event.target.value })}
        hint="The human-readable name for the basket."
      />

      <TextField
        label="Symbol"
        required
        value={draft.symbol}
        error={errors.symbol}
        disabled={disabled}
        maxLength={16}
        placeholder="AIINF"
        onBlur={onBlurField}
        onChange={(event) => onChange({ symbol: event.target.value })}
        hint="The basket token's ticker. Letters and digits, up to 11 characters."
      />

      <TextField
        label="Theme"
        required
        value={draft.theme}
        error={errors.theme}
        disabled={disabled}
        maxLength={40}
        placeholder="Artificial intelligence"
        onBlur={onBlurField}
        onChange={(event) => onChange({ theme: event.target.value })}
        hint="A grouping label. It is how the basket is filed, and how other baskets with the same idea are found."
      />

      <TextArea
        label="Description"
        value={draft.description}
        error={errors.description}
        disabled={disabled}
        rows={5}
        maxLength={700}
        placeholder="What the basket holds and why. Anyone depositing reads this before they read the weights."
        onBlur={onBlurField}
        onChange={(event) => onChange({ description: event.target.value })}
        hint="Optional, but a basket with no stated rationale is a basket nobody can evaluate."
      />
    </FieldGroup>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — composition
// ---------------------------------------------------------------------------

function CompositionStep({
  draft,
  errors,
  totalBps,
  maxComponents,
  settlementSymbol,
  settlementDecimals,
  catalog,
  onChange,
  disabled,
}: {
  draft: BasketDraft;
  errors: { components?: string; weights?: Record<string, string>; total?: string };
  totalBps: number;
  maxComponents: number;
  settlementSymbol: string;
  settlementDecimals: number;
  catalog: ReturnType<typeof useComponentCatalog>;
  onChange: (patch: Partial<BasketDraft>) => void;
  disabled: boolean;
}) {
  const selected = new Set(draft.components.map((address) => address.toLowerCase()));
  const atCapacity = draft.components.length >= maxComponents;
  const totalCorrect = totalBps === BPS_DENOMINATOR;

  return (
    <div className="space-y-8">
      <FieldGroup
        legend="Composition"
        description={`Weights are stored on-chain in basis points, so two decimal places of a percent is the finest distinction that exists. They must total exactly 100%. A basket holds at most ${maxComponents} components.`}
      >
        {draft.components.length === 0 ? (
          <p className="rounded border border-dashed border-rule-strong px-4 py-6 text-center text-sm text-ink-muted">
            Nothing selected yet. Add components from the list below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem]">
              <caption className="sr-only">Selected components and their target weights</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className="label py-2 pr-4 text-left font-medium">
                    Component
                  </th>
                  <th scope="col" className="label py-2 pr-3 text-right font-medium">
                    Weight
                  </th>
                  <th scope="col" className="label py-2 pr-3 text-left font-medium">
                    Percent
                  </th>
                  <th scope="col" className="label py-2 pr-3 text-right font-medium">
                    As basis points
                  </th>
                  <th scope="col" className="label py-2 text-right font-medium">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.components.map((address) => {
                  const key = address.toLowerCase();
                  const entry = catalog.entries.find(
                    (item) => item.token.address.toLowerCase() === key,
                  );
                  const symbol = entry?.token.symbol ?? `${address.slice(0, 6)}…`;
                  const raw = draft.weights[key] ?? '';
                  const parsed = percentToBps(raw);
                  const error = errors.weights?.[key];

                  return (
                    <Fragment key={key}>
                      <tr className="border-b border-rule align-top">
                        <th scope="row" className="py-3 pr-4 text-left font-normal">
                          <span className="figure block text-sm text-ink">{symbol}</span>
                          <span className="mt-0.5 block text-xs text-ink-faint">
                            {entry ? entry.token.name : 'Unknown token'}
                          </span>
                          {entry?.price != null ? (
                            <span className="figure mt-1 block text-xs text-ink-muted">
                              {formatSettlement(entry.price, settlementDecimals, settlementSymbol, {
                                displayDecimals: 2,
                                minDecimals: 2,
                              })}
                            </span>
                          ) : (
                            <span className="mt-1 block text-xs text-warning">
                              No price from the feed
                            </span>
                          )}
                        </th>

                        <td className="py-3 pr-3 text-right">
                          <input
                            value={raw}
                            disabled={disabled}
                            inputMode="decimal"
                            aria-label={`Target weight for ${symbol}, in percent`}
                            aria-invalid={error ? true : undefined}
                            onChange={(event) =>
                              onChange({ weights: { ...draft.weights, [key]: event.target.value } })
                            }
                            className={`${controlClass} figure w-24 py-1.5 text-right`}
                          />
                        </td>

                        <td className="py-3 pr-3 text-left text-sm text-ink-muted">%</td>

                        <td className="py-3 pr-3 text-right">
                          <span className="figure text-sm text-ink">
                            {parsed.ok ? parsed.bps : '—'}
                          </span>
                        </td>

                        <td className="py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => onChange({ ...removeComponent(draft, address) })}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>

                      {/* A row of its own rather than a cell inside the one
                          above: an error that spans the table still belongs to
                          the input that caused it, and a reader announced
                          "row 3 of 4, error" hears the connection. */}
                      {error ? (
                        <tr className="border-b border-rule">
                          <td colSpan={5} className="pb-3 text-xs font-medium text-negative">
                            Error: {error}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink">
                  <th scope="row" className="py-3 pr-4 text-left text-sm font-semibold text-ink">
                    Total
                  </th>
                  <td className="py-3 pr-3" />
                  <td className="py-3 pr-3" />
                  <td className="py-3 pr-3 text-right">
                    <span
                      className={`figure text-sm ${totalCorrect ? 'text-positive' : 'text-negative'}`}
                    >
                      {totalBps}
                    </span>
                    <span className="figure ml-1.5 text-xs text-ink-faint">
                      / {BPS_DENOMINATOR}
                    </span>
                  </td>
                  <td className="py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || draft.components.length < 2}
            onClick={() => onChange({ ...redistribute(draft) })}
          >
            Distribute evenly
          </Button>
          <span className="text-xs text-ink-faint">
            Splits 100% across the selected components, keeping the selection.
          </span>
        </div>

        {errors.total ? (
          <p className="flex items-start gap-2 text-sm text-negative">
            <RiskMark tone="negative" />
            <span>{errors.total}</span>
          </p>
        ) : null}

        {errors.components ? (
          <p className="text-sm text-negative">Error: {errors.components}</p>
        ) : null}
      </FieldGroup>

      {/* -- Picker ---------------------------------------------------------- */}
      <div>
        <h3 className="text-base font-semibold text-ink">Add a component</h3>
        <p className="mt-1 mb-4 max-w-prose text-sm text-ink-muted">
          {catalog.source === 'deployment'
            ? 'The mock assets this deployment ships with. Their contracts are real; their prices are not.'
            : 'Assets discovered from the components of baskets already deployed on this network.'}
        </p>

        {catalog.loading ? (
          <LoadingState message="Reading the available assets…" />
        ) : catalog.error ? (
          <ErrorState
            title="The asset list could not be read"
            detail="Components cannot be chosen without knowing which tokens this deployment recognises."
            onRetry={catalog.refetch}
          />
        ) : catalog.entries.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No component assets are known on this network, so there is nothing to compose with.
          </p>
        ) : (
          <ul className="border-t border-rule">
            {catalog.entries.map((entry) => {
              const key = entry.token.address.toLowerCase();
              const isSelected = selected.has(key);

              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule py-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="figure text-sm text-ink">{entry.token.symbol}</span>
                      <span className="text-xs text-ink-faint">{entry.token.name}</span>
                    </p>
                    <div className="mt-1">
                      <AddressChip address={entry.token.address} visible={4} />
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <span className="figure text-sm text-ink-muted">
                      {entry.price === null
                        ? 'Not priced'
                        : formatSettlement(entry.price, settlementDecimals, settlementSymbol, {
                            displayDecimals: 2,
                            minDecimals: 2,
                          })}
                    </span>

                    {isSelected ? (
                      <span className="text-xs text-ink-faint">Selected</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={disabled || atCapacity || !entry.allowed}
                        onClick={() => onChange({ ...addComponent(draft, entry.token.address) })}
                      >
                        {!entry.allowed ? 'Not allowed' : atCapacity ? 'Limit reached' : 'Add'}
                      </Button>
                    )}
                  </div>

                  {!entry.allowed ? (
                    <p className="w-full text-xs text-warning">
                      The factory's allowlist does not currently accept this token as a component.
                    </p>
                  ) : entry.price === null ? (
                    <p className="w-full text-xs text-warning">
                      The price feed has no usable price for this asset. Including it would make
                      every deposit and redemption revert until the feed recovers.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {atCapacity ? (
          <p className="mt-3 text-xs text-ink-muted">
            This basket already holds the maximum of {maxComponents} components.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — fees
// ---------------------------------------------------------------------------

function FeesStep({
  draft,
  errors,
  onBlurField,
  limits,
  defaults,
  onChange,
  disabled,
}: {
  draft: BasketDraft;
  errors: { depositFee?: string; redeemFee?: string; creatorShare?: string; slippage?: string };
  /** Called when any field is left, so the step can stop holding its errors back. */
  onBlurField: () => void;
  limits: {
    depositFeeBps: number;
    redeemFeeBps: number;
    creatorShareBps: number;
    maxSlippageBps: number;
  };
  defaults: {
    depositFeeBps: number;
    redeemFeeBps: number;
    creatorShareBps: number;
    maxSlippageBps: number;
  };
  onChange: (patch: Partial<BasketDraft>) => void;
  disabled: boolean;
}) {
  const creator = percentToBps(draft.creatorShare);
  const protocolShareBps = creator.ok ? BPS_DENOMINATOR - creator.bps : null;

  return (
    <FieldGroup
      legend="Fees"
      description="Charged by the basket contract on every deposit and redemption, and split between you and the protocol. Fixed at deployment: neither you nor the protocol's administrator can change these afterwards, on this basket or any other that already exists."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <AmountField
          label="Deposit fee"
          required
          value={draft.depositFee}
          error={errors.depositFee}
          disabled={disabled}
          onBlur={onBlurField}
          onChange={(event) => onChange({ depositFee: event.target.value })}
          hint={`Taken from each deposit before it is invested. This deployment allows up to ${(limits.depositFeeBps / 100).toFixed(2)}%; the default is ${(defaults.depositFeeBps / 100).toFixed(2)}%.`}
        />

        <AmountField
          label="Redemption fee"
          required
          value={draft.redeemFee}
          error={errors.redeemFee}
          disabled={disabled}
          onBlur={onBlurField}
          onChange={(event) => onChange({ redeemFee: event.target.value })}
          hint={`Taken from each redemption before it is paid out. Up to ${(limits.redeemFeeBps / 100).toFixed(2)}% here; the default is ${(defaults.redeemFeeBps / 100).toFixed(2)}%.`}
        />

        <AmountField
          label="Your share of each fee"
          required
          value={draft.creatorShare}
          error={errors.creatorShare}
          disabled={disabled}
          onBlur={onBlurField}
          onChange={(event) => onChange({ creatorShare: event.target.value })}
          hint={
            protocolShareBps === null
              ? `The remainder goes to the protocol. Up to ${(limits.creatorShareBps / 100).toFixed(2)}% here.`
              : `The remaining ${(protocolShareBps / 100).toFixed(2)}% goes to the protocol treasury. Up to ${(limits.creatorShareBps / 100).toFixed(2)}% here.`
          }
        />

        <AmountField
          label="Depositor slippage tolerance"
          required
          value={draft.slippage}
          error={errors.slippage}
          disabled={disabled}
          onBlur={onBlurField}
          onChange={(event) => onChange({ slippage: event.target.value })}
          hint={`How far a price may move between a depositor's quote and their block before the transaction reverts instead. Up to ${(limits.maxSlippageBps / 100).toFixed(2)}%. A tight tolerance protects depositors and fails more often.`}
        />
      </div>

      <Notice tone="neutral" title="What these numbers do to a depositor">
        A depositor who puts in 1,000 units pays the deposit fee on the way in and the redemption
        fee on the way out, so a round trip costs them the sum of the two. A basket whose fees are
        high enough to matter is a basket that has to outperform by that much before anyone breaks
        even — worth stating in the description rather than leaving for them to work out.
      </Notice>
    </FieldGroup>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — review
// ---------------------------------------------------------------------------

function ReviewStep({
  draft,
  catalog,
  valid,
  limits,
  settlementSymbol,
  factory,
}: {
  draft: BasketDraft;
  catalog: ReturnType<typeof useComponentCatalog>;
  valid: boolean;
  limits: {
    depositFeeBps: number;
    redeemFeeBps: number;
    creatorShareBps: number;
    maxSlippageBps: number;
  };
  settlementSymbol: string;
  factory: Address;
}) {
  const components = draft.components.map((address) => {
    const key = address.toLowerCase();
    const entry = catalog.entries.find((item) => item.token.address.toLowerCase() === key);
    const parsed = percentToBps(draft.weights[key] ?? '');
    return {
      address,
      symbol: entry?.token.symbol ?? `${address.slice(0, 6)}…`,
      name: entry?.token.name ?? 'Unknown token',
      weightBps: parsed.ok ? parsed.bps : 0,
    };
  });

  const feeOf = (raw: string) => {
    const parsed = percentToBps(raw);
    return parsed.ok ? `${(parsed.bps / 100).toFixed(2)}%` : '—';
  };

  return (
    <div className="space-y-8">
      <div className="border-t-2 border-ink pt-5">
        <h3 className="font-display text-2xl text-ink">{draft.name || 'Untitled basket'}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 text-xs text-ink-muted">
          <span className="figure">{draft.symbol.toUpperCase() || '—'}</span>
          <span aria-hidden="true" className="text-rule-strong">
            ·
          </span>
          <span>{draft.theme || '—'}</span>
        </p>
        {draft.description ? (
          <p className="mt-4 max-w-[70ch] leading-relaxed text-ink-muted">{draft.description}</p>
        ) : null}

        <div className="mt-5 max-w-2xl">
          <BasketAllocation segments={components} size="lg" />
        </div>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <p className="label">Composition</p>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-rule border-y border-rule">
              {components.map((component) => (
                <tr key={component.address}>
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                    <span className="figure text-ink">{component.symbol}</span>
                    <span className="mt-0.5 block text-xs text-ink-faint">{component.name}</span>
                  </th>
                  <td className="py-2.5 text-right">
                    <span className="figure text-ink">{formatWeight(component.weightBps)}</span>
                    <span className="figure ml-2 text-xs text-ink-faint">
                      {component.weightBps} bps
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="py-2.5 text-left text-sm font-semibold text-ink">
                  Total
                </th>
                <td className="py-2.5 text-right">
                  <span className="figure text-sm text-ink">
                    {components.reduce((running, component) => running + component.weightBps, 0)}{' '}
                    bps
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div>
          <p className="label">Terms</p>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-rule border-y border-rule">
              <ReviewRow label="Deposit fee" value={feeOf(draft.depositFee)} />
              <ReviewRow label="Redemption fee" value={feeOf(draft.redeemFee)} />
              <ReviewRow label="Your share of fees" value={feeOf(draft.creatorShare)} />
              <ReviewRow
                label="Protocol's share"
                value={(() => {
                  const parsed = percentToBps(draft.creatorShare);
                  return parsed.ok ? `${((BPS_DENOMINATOR - parsed.bps) / 100).toFixed(2)}%` : '—';
                })()}
              />
              <ReviewRow label="Slippage tolerance" value={feeOf(draft.slippage)} />
              <ReviewRow label="Settlement asset" value={settlementSymbol} />
            </tbody>
          </table>

          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            The ceilings this deployment applies are {(limits.depositFeeBps / 100).toFixed(2)}%
            deposit, {(limits.redeemFeeBps / 100).toFixed(2)}% redemption,{' '}
            {(limits.creatorShareBps / 100).toFixed(2)}% creator share and{' '}
            {(limits.maxSlippageBps / 100).toFixed(2)}% slippage. Your values are within all four.
          </p>
        </div>
      </div>

      <Notice tone="warning" title="Deploying this is permanent">
        This deploys a new contract that holds other people's money. Once it is confirmed, the name,
        the symbol, the theme, the component list, the weights and all four fee parameters are fixed
        for the life of the basket. There is no upgrade path, no administrator override, and no way
        to edit this basket afterwards. Read the composition above once more before you continue.
      </Notice>

      {!valid ? (
        <Notice tone="negative" title="Something above is still incomplete">
          One of the earlier steps has a value the contract would reject. Go back through the steps
          — the ones that are finished are ticked in the strip above.
        </Notice>
      ) : null}

      <p className="text-xs leading-relaxed text-ink-faint">
        The basket will be deployed by the factory at <span className="figure">{factory}</span>, and
        you will be recorded as its creator. That address is the only one that can claim the
        creator's share of the fees.
      </p>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row" className="py-2.5 pr-4 text-left font-normal text-ink-muted">
        {label}
      </th>
      <td className="py-2.5 text-right">
        <span className="figure text-ink">{value}</span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — deploy
// ---------------------------------------------------------------------------

function DeployStep({
  create,
  createdBasket,
  valid,
  onDeploy,
}: {
  create: ReturnType<typeof useCreateBasket>;
  createdBasket: Address | null;
  valid: boolean;
  onDeploy: () => void;
}) {
  if (createdBasket) {
    return (
      <div className="border-t-2 border-positive pt-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-positive">
          <RiskMark tone="positive" />
          Deployed
        </p>
        <h3 className="mt-3 font-display text-2xl text-ink">The basket exists on-chain.</h3>
        <p className="mt-3 max-w-[62ch] leading-relaxed text-ink-muted">
          It holds nothing yet. There is no initial deposit and no premine — until the first
          deposit, the net asset value per token reports one whole unit of the settlement asset,
          which is the convention the contract uses for an empty basket. Anyone, including you, can
          deposit into it now.
        </p>

        <dl className="mt-6 max-w-md space-y-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <dt className="text-ink-muted">Basket contract</dt>
            <dd>
              <AddressChip address={createdBasket} visible={6} />
            </dd>
          </div>
        </dl>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href={`/baskets/${createdBasket}`}
            className="inline-flex h-11 items-center justify-center rounded bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Open the basket
          </Link>
          <Link
            href="/creator"
            className="inline-flex h-11 items-center justify-center rounded border border-rule-strong px-5 text-sm font-medium text-ink transition-colors hover:bg-sunken"
          >
            Creator studio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 border-t-2 border-ink pt-5">
      <div>
        <h3 className="font-display text-2xl text-ink">Deploy</h3>
        <p className="mt-2 max-w-[62ch] leading-relaxed text-ink-muted">
          One transaction. The factory deploys the basket contract, records you as its creator, and
          the whole composition is written into the new contract's storage. After this it cannot be
          changed by anyone.
        </p>
      </div>

      {!valid ? (
        <Notice tone="negative" title="Not ready to deploy">
          An earlier step still has a value the contract would reject. Use the strip above to go
          back to it.
        </Notice>
      ) : (
        <Notice tone="warning" title="This is a real transaction">
          It costs gas, it is irreversible, and it creates a contract that will hold deposits.
          Confirm only if the review step matched what you intended.
        </Notice>
      )}

      <TransactionStatusPanel
        state={create.state}
        onRetry={onDeploy}
        onDismiss={create.reset}
        retryLabel="Try the deployment again"
      />

      <Button
        variant="primary"
        size="lg"
        busy={create.busy}
        disabled={!valid || create.busy}
        onClick={onDeploy}
      >
        {create.busy ? 'Deploying…' : 'Deploy this basket'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The live preview
// ---------------------------------------------------------------------------

/**
 * The composition, drawn as it is typed.
 *
 * Sticky on a wide screen so it stays beside the weight fields — the point of a
 * preview is to be visible while the thing it previews is being edited, and a
 * preview that scrolls away is a preview that is read once at the end.
 */
function PreviewPanel({
  draft,
  totalBps,
  catalog,
}: {
  draft: BasketDraft;
  totalBps: number;
  catalog: ReturnType<typeof useComponentCatalog>;
}) {
  const segments = useMemo(
    () =>
      draft.components.map((address) => {
        const key = address.toLowerCase();
        const entry = catalog.entries.find((item) => item.token.address.toLowerCase() === key);
        const parsed = percentToBps(draft.weights[key] ?? '');
        return {
          symbol: entry?.token.symbol ?? `${address.slice(0, 4)}…`,
          weightBps: parsed.ok ? parsed.bps : 0,
        };
      }),
    [draft.components, draft.weights, catalog.entries],
  );

  const correct = totalBps === BPS_DENOMINATOR;
  const unassigned = BPS_DENOMINATOR - totalBps;

  return (
    <aside aria-label="Live preview of the basket being created" className="lg:sticky lg:top-24">
      <div className="rounded border border-rule bg-surface">
        <div className="border-b border-rule px-5 py-3.5">
          <p className="label">Preview</p>
          <p className="mt-1 truncate font-display text-lg text-ink">
            {draft.name.trim() || 'Untitled basket'}
          </p>
          <p className="figure text-xs text-ink-muted">
            {draft.symbol.trim().toUpperCase() || '—'}
            {draft.theme.trim() ? ` · ${draft.theme.trim()}` : ''}
          </p>
        </div>

        <div className="px-5 py-5">
          {segments.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">
              The allocation band appears here as components are added.
            </p>
          ) : (
            <>
              <BasketAllocation segments={segments} size="md" />

              <ul className="mt-4 space-y-2">
                {segments.map((segment, index) => (
                  <li
                    key={`${segment.symbol}-${index}`}
                    className="flex items-baseline justify-between gap-4 text-sm"
                  >
                    <span className="figure text-ink-muted">{segment.symbol}</span>
                    <span className="figure text-ink">{formatWeight(segment.weightBps)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-rule pt-3">
                <span className="text-xs text-ink-muted">Total</span>
                <span className={`figure text-sm ${correct ? 'text-positive' : 'text-negative'}`}>
                  {(totalBps / 100).toFixed(2)}%
                </span>
              </div>

              {!correct ? (
                <p className="mt-2 text-xs leading-relaxed text-negative">
                  {unassigned > 0
                    ? `${(unassigned / 100).toFixed(2)}% is unassigned. Weights must total exactly 100%.`
                    : `${(Math.abs(unassigned) / 100).toFixed(2)}% over 100%. Weights must total exactly 100%.`}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="border-t border-rule px-5 py-4">
          <dl className="space-y-2 text-xs">
            <PreviewRow label="Deposit fee" value={previewPercent(draft.depositFee)} />
            <PreviewRow label="Redemption fee" value={previewPercent(draft.redeemFee)} />
            <PreviewRow label="Your share" value={previewPercent(draft.creatorShare)} />
            <PreviewRow label="Slippage" value={previewPercent(draft.slippage)} />
          </dl>
        </div>
      </div>

      <div className="mt-4">
        <MockDataNotice subject="The component prices in this preview" compact />
      </div>
    </aside>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="figure text-ink">{value}</dd>
    </div>
  );
}

function previewPercent(raw: string): string {
  const parsed = percentToBps(raw);
  if (!parsed.ok) return '—';
  return `${bpsToPercent(parsed.bps)}%`;
}
