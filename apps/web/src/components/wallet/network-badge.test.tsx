import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_IDS, SUPPORTED_CHAINS, getChain, publicEnv } from '@thematic/config';
import { NetworkBadge, NetworkGuard } from './network-badge.tsx';

/**
 * Which chain the wallet is on, and what the app does about it.
 *
 * `NetworkGuard` is the quiet failure this file exists for. A wallet parked on
 * a *supported* chain that is not the configured one still reads nothing —
 * `getAddressBook()` only knows one deployment — so the page renders empty with
 * no explanation. Guarding only on "is this chain supported?" left exactly that
 * case uncovered, and these tests pin the comparison to the configured chain
 * instead.
 */

const { useChainIdMock, useSwitchChainMock } = vi.hoisted(() => ({
  useChainIdMock: vi.fn(),
  useSwitchChainMock: vi.fn(),
}));

/**
 * A whole-module factory rather than `importOriginal`.
 *
 * These components take two hooks from wagmi and nothing else, so evaluating
 * wagmi's real module graph in jsdom would only add something that can fail
 * before the first assertion. A missing export fails loudly instead.
 */
vi.mock('wagmi', () => ({
  useChainId: useChainIdMock,
  useSwitchChain: useSwitchChainMock,
}));

/** The chain this build is configured for — read, not assumed. */
const CONFIGURED = publicEnv.chainId;

/** A different chain the app supports, so the guard has a real target. */
const OTHER_SUPPORTED = SUPPORTED_CHAINS.map((chain) => chain.id).find((id) => id !== CONFIGURED)!;

const switchChain = vi.fn();

beforeEach(() => {
  useChainIdMock.mockReturnValue(CONFIGURED);
  useSwitchChainMock.mockReturnValue({
    switchChain,
    isPending: false,
    error: undefined,
  });
});

describe('NetworkBadge', () => {
  it('names the chain the wallet is on', () => {
    useChainIdMock.mockReturnValue(CHAIN_IDS.bscTestnet);
    render(<NetworkBadge />);

    expect(screen.getByText('BNB Smart Chain Testnet')).toBeInTheDocument();
  });

  it('marks a chain that is a testnet as one', () => {
    useChainIdMock.mockReturnValue(CHAIN_IDS.bscTestnet);
    render(<NetworkBadge />);

    expect(screen.getByText('testnet')).toBeInTheDocument();
  });

  it('does not call mainnet a testnet', () => {
    useChainIdMock.mockReturnValue(CHAIN_IDS.bsc);
    render(<NetworkBadge />);

    expect(screen.getByText('BNB Smart Chain')).toBeInTheDocument();
    expect(screen.queryByText('testnet')).toBeNull();
  });

  it('does not call the local chain a testnet', () => {
    // Hardhat's chain has no testnet of its own, and the badge sits where a
    // reader is working out what they are looking at. Saying "testnet" there
    // would be a small lie in the one place that has to be exact.
    useChainIdMock.mockReturnValue(CHAIN_IDS.local);
    render(<NetworkBadge />);

    expect(screen.getByText('Hardhat')).toBeInTheDocument();
    expect(screen.queryByText('testnet')).toBeNull();
  });

  it('says so, rather than disappearing, on a chain the app does not support', () => {
    // A hidden indicator leaves the user reading figures from one deployment
    // with a wallet pointed at another, and nothing on screen saying so.
    useChainIdMock.mockReturnValue(1);
    render(<NetworkBadge />);

    expect(screen.getByText('Unsupported network')).toBeInTheDocument();
  });
});

describe('NetworkGuard', () => {
  it('renders nothing when the wallet is on the configured chain', () => {
    const { container } = render(<NetworkGuard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('warns when the wallet is on a different chain the app supports', () => {
    // The case a "is this chain supported?" check misses entirely.
    useChainIdMock.mockReturnValue(OTHER_SUPPORTED);
    render(<NetworkGuard />);

    // Asserted as the whole sentence rather than by looking the target's name up
    // on its own: the name also appears in the "Switch to …" button, so a
    // substring query matches two elements and `getByText` throws rather than
    // telling anyone anything about the copy.
    expect(
      screen.getByText(
        `Your wallet is on ${getChain(OTHER_SUPPORTED).name}, but this app reads a deployment on ${
          getChain(CONFIGURED).name
        }.`,
      ),
    ).toBeInTheDocument();
  });

  it('warns when the wallet is on a chain nobody supports', () => {
    useChainIdMock.mockReturnValue(1);
    render(<NetworkGuard />);

    expect(screen.getByText(/an unsupported network/)).toBeInTheDocument();
  });

  it('reassures the user that nothing was sent', () => {
    useChainIdMock.mockReturnValue(OTHER_SUPPORTED);
    render(<NetworkGuard />);

    expect(screen.getByText(/Nothing has been sent and nothing is at risk/i)).toBeInTheDocument();
  });

  it('offers the switch as an action rather than leaving the user to find it', () => {
    useChainIdMock.mockReturnValue(OTHER_SUPPORTED);
    render(<NetworkGuard />);

    const target = getChain(CONFIGURED);
    expect(screen.getByRole('button', { name: `Switch to ${target.name}` })).toBeInTheDocument();
  });

  it('asks the wallet to switch to the chain this build actually reads', async () => {
    // Not a hard-coded testnet: a local build told to switch to BNB testnet
    // would send the user somewhere the contracts do not exist.
    const user = userEvent.setup();
    useChainIdMock.mockReturnValue(OTHER_SUPPORTED);
    render(<NetworkGuard />);

    await user.click(screen.getByRole('button', { name: /^Switch to / }));

    expect(switchChain).toHaveBeenCalledWith({ chainId: CONFIGURED });
  });

  it('marks the button busy while the wallet is being asked', () => {
    useSwitchChainMock.mockReturnValue({ switchChain, isPending: true, error: undefined });
    useChainIdMock.mockReturnValue(OTHER_SUPPORTED);
    render(<NetworkGuard />);

    expect(screen.getByRole('button', { name: /^Switch to / })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('reports a failed switch, which is otherwise silent', () => {
    // A rejected `wallet_switchEthereumChain` surfaces nowhere else: the chain
    // does not change, so without this line the button appears to do nothing.
    useSwitchChainMock.mockReturnValue({
      switchChain,
      isPending: false,
      error: new Error('User rejected the request.'),
    });
    useChainIdMock.mockReturnValue(OTHER_SUPPORTED);
    render(<NetworkGuard />);

    expect(screen.getByText('User rejected the request.')).toBeInTheDocument();
  });

  it('says nothing about switching when there is no error', () => {
    useChainIdMock.mockReturnValue(OTHER_SUPPORTED);
    render(<NetworkGuard />);

    expect(screen.queryByText(/User rejected/)).toBeNull();
  });
});
