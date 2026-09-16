import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unit/API tests exercise routes without a browser login gate.
process.env.SMSALL_AUTH_DISABLED = process.env.SMSALL_AUTH_DISABLED || '1';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
