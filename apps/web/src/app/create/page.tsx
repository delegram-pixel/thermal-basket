'use client';

import { useAccount } from 'wagmi';
import { Container, Section } from '@/components/ui/layout.tsx';
import { EmptyState } from '@/components/ui/states.tsx';
import { WalletButton } from '@/components/wallet/wallet-button.tsx';
import { CreateBasketForm } from '@/features/creation/create-basket-form.tsx';

/**
 * Creating a basket (§23).
 *
 * The route is thin: a masthead, a wallet gate, and the form. The gate is here
 * rather than inside the form because it is not a step of creation — it is a
 * precondition for the page having anything to say. A creator who has not
 * connected a wallet can read what a basket is and what it costs, but the five
 * steps are about a specific creator's basket and there is no creator yet.
 */
export default function CreatePage() {
  return (
    <Section className="pt-12 pb-20 sm:pt-16">
      <Container width="wide">
        <header className="border-b border-ink pb-4">
          <p className="label">Create</p>
          <h1 className="mt-2 text-[2rem] leading-tight sm:text-[2.5rem]">Compose a basket</h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
            A basket is a fixed set of weighted components, deployed as its own contract, that
            anyone can deposit into. You choose the composition and the fees once; after deployment
            neither you nor the protocol can change either. The scale of the decision is the reason
            this form is five steps rather than one screen.
          </p>
        </header>

        <div className="pt-10">
          <Gate />
        </div>
      </Container>
    </Section>
  );
}

function Gate() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return (
      <EmptyState
        title="Connect a wallet to create a basket"
        description="The contract records an address as the basket's creator, and that address is the only one that can ever claim the creator's share of the fees. It also has to be the wallet that pays for the deployment."
        action={<WalletButton />}
      />
    );
  }

  return <CreateBasketForm />;
}
