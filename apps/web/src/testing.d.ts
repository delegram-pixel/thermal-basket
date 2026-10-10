/**
 * Brings the DOM assertions into `tsc --noEmit` (§36).
 *
 * `vitest.setup.ts` registers `toBeInTheDocument`, `toHaveAccessibleName` and
 * the rest at runtime, but it lives at the repository root and is outside this
 * workspace's `include`, so its `declare module 'vitest'` augmentation never
 * reaches the app's type program. Without this file the tests compile with the
 * matchers missing and `yarn typecheck` fails on assertions that already pass.
 *
 * Types only — nothing here is emitted or executed.
 */
import '@testing-library/jest-dom/vitest';
