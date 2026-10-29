import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { validateChat } = require('../server/proxy-core.cjs') as { validateChat: (value: unknown) => { error?: string } };

describe('free end-user access contract', () => {
  it('has no billing-provider dependency and treats generation bounds as per-request technical validation', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter(name => /stripe|paypal|braintree|paddle|chargebee|payment/i.test(name))).toEqual([]);
    expect(validateChat({ message: 'free core chat', max_new_tokens: 64 }).error).toBeUndefined();
  });
  it('does not retain product allowance or credit logic in the model proxy', () => {
    const proxy = readFileSync('server/proxy-core.cjs', 'utf8');
    expect(proxy).not.toMatch(/credit|subscription|paid tier|daily allowance|monthly allowance|token-generation quota/i);
    expect(proxy).toContain('temporarily full');
    expect(proxy).toContain('Retry-After');
  });
});
