import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof window !== 'undefined') Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});
