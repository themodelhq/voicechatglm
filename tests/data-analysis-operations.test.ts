import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { transformDataset, validateOperation } = require('../server/data-analysis.cjs') as typeof import('../server/data-analysis.cjs');

describe('bounded deterministic data operations', () => {
  const dataset = { header: ['Region', 'Amount', 'Status'], rows: [['South', '2', 'open'], ['North', '10', 'closed'], ['West', '1', 'open']] };
  it('sorts numeric values deterministically and filters exact literal values without executing them', () => {
    expect(transformDataset(dataset, { kind: 'sort', by: 'Amount', direction: 'desc' }).dataset.rows.map((row: string[]) => row[1])).toEqual(['10', '2', '1']);
    expect(transformDataset(dataset, { kind: 'filter', by: 'Status', equals: 'open' }).dataset.rows.map((row: string[]) => row[0])).toEqual(['South', 'West']);
    expect(transformDataset({ header: ['Formula'], rows: [['=2+2'], ['=1+1']] }, { kind: 'sort', by: 'Formula' }).dataset.rows).toEqual([['=1+1'], ['=2+2']]);
  });
  it('validates supported operation fields and rejects undeclared/general-execution inputs', () => {
    expect(validateOperation({ kind: 'filter', by: 'Status', equals: 'open' })).toEqual({ kind: 'filter', by: 'Status', equals: 'open' });
    expect(validateOperation({ kind: 'sort', by: 'Amount', direction: 'asc' })).toEqual({ kind: 'sort', by: 'Amount', direction: 'asc' });
    expect(validateOperation({ kind: 'filter', by: 'Status' })).toBeUndefined();
    expect(validateOperation({ kind: 'shell', command: 'rm -rf /' })).toBeUndefined();
  });
});
