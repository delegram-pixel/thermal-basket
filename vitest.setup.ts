import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Registers the DOM assertions — `toBeInTheDocument`, `toHaveAccessibleName`
 * and the rest — against Vitest's `expect`, and unmounts whatever a test
 * rendered.
 *
 * The cleanup is explicit because Testing Library only installs its own
 * automatic cleanup when `afterEach` exists as a global, and this config
 * imports `describe`/`it`/`expect` from `vitest` rather than turning `globals`
 * on. Without this, a component rendered in one test stays mounted in the
 * document for the next one, and queries that should find one node find two.
 */
afterEach(() => {
  cleanup();
});
