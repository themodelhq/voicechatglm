import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { DEFAULTS } = require('../server/files/policy.cjs') as { DEFAULTS: Record<string, number> };
const { inspectZipArchive, redactSecrets } = require('../server/files/zipAnalysis.cjs') as { inspectZipArchive: (input: { buffer: Buffer; filename: string; policy: Record<string, number> }) => Promise<any>; redactSecrets: (text: string, filename?: string) => { text: string; redacted: boolean } };
const { analyzeRecords } = require('../server/files/analysis.cjs') as { analyzeRecords: (options: any) => Promise<any> };
const { store, getOwned, resetForTests } = require('../server/files/storage.cjs') as { store: (owner: string, files: any[], policy: Record<string, number>) => Array<{ id: string }>; getOwned: (owner: string, id: string) => any; resetForTests: () => void };

function crc32(buffer: Buffer): number { let value = 0xffffffff; for (const byte of buffer) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
type Entry = { name: string; value?: string | Buffer; encrypted?: boolean; compressionMethod?: number; compressed?: boolean; externalAttributes?: number; declaredUncompressedSize?: number };
function zip(entries: Entry[]): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const item of entries) {
    const filename = Buffer.from(item.name); const raw = Buffer.isBuffer(item.value) ? item.value : Buffer.from(item.value ?? ''); const data = item.compressed ? deflateRawSync(raw) : raw; const crc = crc32(raw); const declaredSize = item.declaredUncompressedSize ?? raw.length; const flags = item.encrypted ? 1 : 0; const method = item.compressionMethod ?? (item.compressed ? 8 : 0);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(declaredSize, 22); header.writeUInt16LE(filename.length, 26); local.push(header, filename, data);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(declaredSize, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE((item.externalAttributes ?? 0) >>> 0, 38); directory.writeUInt32LE(offset, 42); central.push(directory, filename); offset += header.length + filename.length + data.length;
  }
  const directoryData = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directoryData.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...local, directoryData, end]);
}
const inspect = (entries: Entry[], policy: Record<string, number> = DEFAULTS) => inspectZipArchive({ buffer: zip(entries), filename: 'project.zip', policy });

describe('safe ZIP archive inspection and analysis', () => {
  it('creates a real manifest, extracts supported project files, redacts example secrets, and lists exclusions', async () => {
    const archive = await inspect([
      { name: 'README.md', value: '# Demo\nArchitecture notes.' }, { name: 'src/auth/session.ts', value: 'export const session = true;' }, { name: 'package.json', value: '{"name":"demo"}' }, { name: '.env', value: 'API_KEY=actual-secret' }, { name: '.env.example', value: 'API_KEY=placeholder-secret' }, { name: 'assets/logo.bin', value: 'binary' }, { name: 'vendor/nested.zip', value: zip([{ name: 'inside.txt', value: 'never recurse' }]) },
    ]);
    expect(archive.manifest.summary.totalEntries).toBe(7); expect(archive.manifest.summary.analyzedFiles).toBe(4); expect(archive.manifest.partial).toBe(true);
    expect(archive.files.map((file: any) => file.path)).toEqual(expect.arrayContaining(['README.md', 'src/auth/session.ts', 'package.json', '.env.example']));
    expect(archive.files.find((file: any) => file.path === '.env.example').text).toContain('[REDACTED]');
    expect(archive.manifest.members.find((member: any) => member.path === '.env')?.reason).toMatch(/secret-bearing/);
    expect(archive.manifest.members.find((member: any) => member.path === 'vendor/nested.zip')?.extraction).toBe('not-inspected');
    expect(archive.manifest.members.find((member: any) => member.path === 'assets/logo.bin')?.validation).toBe('unsupported');
  });
  it('redacts bearer/JWT, database, cloud, and password-like credential values without reproducing them', () => {
    const secret = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signatureValueWithEnoughLength'; const output = redactSecrets(`Authorization: Bearer abcdefghijklmnop\nTOKEN=${secret}\nDATABASE_URL=postgres://user:db-password@db.example/app\nAWS=AKIAABCDEFGHIJKLMNOP\npassword=hunter2`, 'settings.txt');
    expect(output.redacted).toBe(true); expect(output.text).not.toContain(secret); expect(output.text).not.toContain('db-password'); expect(output.text).not.toContain('AKIAABCDEFGHIJKLMNOP'); expect(output.text).not.toContain('hunter2'); expect(output.text).toContain('[REDACTED]');
  });
  it('rejects corruption, unsafe paths, duplicates, encryption, special entries, unsupported methods, depth, and bomb-shaped metadata', async () => {
    await expect(inspectZipArchive({ buffer: zip([{ name: 'README.md', value: 'x' }]).subarray(0, 20), filename: 'bad.zip', policy: DEFAULTS })).rejects.toThrow(/malformed|truncated/);
    await expect(inspect([{ name: '../escape.txt', value: 'x' }])).rejects.toThrow(/unsafe path/);
    await expect(inspect([{ name: '/absolute.txt', value: 'x' }])).rejects.toThrow(/unsafe path/);
    await expect(inspect([{ name: 'C:drive.txt', value: 'x' }])).rejects.toThrow(/unsafe path/);
    await expect(inspect([{ name: 'same.txt', value: 'a' }, { name: 'SAME.txt', value: 'b' }])).rejects.toThrow(/duplicate/);
    await expect(inspect([{ name: 'secret.txt', value: 'x', encrypted: true }])).rejects.toThrow(/Encrypted|malformed/);
    await expect(inspect([{ name: 'link', value: 'x', externalAttributes: (0o120777 << 16) >>> 0 }])).rejects.toThrow(/symbolic link|special/);
    await expect(inspect([{ name: 'unknown.txt', value: 'x', compressionMethod: 12 }])).rejects.toThrow(/unsupported compression/);
    await expect(inspect([{ name: 'a/b/c/d/e.txt', value: 'x' }], { ...DEFAULTS, maxZipDirectoryDepth: 3 })).rejects.toThrow(/unsafe path/);
    await expect(inspect([{ name: 'ratio.txt', value: 'x'.repeat(10_000), compressed: true }], { ...DEFAULTS, maxZipExpansionRatio: 10 })).rejects.toThrow(/expansion ratio/);
  });
  it('enforces entry, total, member, and supported-file limits while reporting safe exclusions', async () => {
    await expect(inspect([{ name: 'a.txt', value: '1' }, { name: 'b.txt', value: '2' }], { ...DEFAULTS, maxZipEntries: 1 })).rejects.toThrow(/entry limit/);
    await expect(inspect([{ name: 'a.txt', value: '123456' }], { ...DEFAULTS, maxZipUncompressedBytes: 4 })).rejects.toThrow(/uncompressed-size/);
    const archive = await inspect([{ name: 'large.txt', value: '123456' }, { name: 'ok.txt', value: 'ok' }], { ...DEFAULTS, maxZipMemberBytes: 4 });
    expect(archive.manifest.members.find((member: any) => member.path === 'large.txt')).toEqual(expect.objectContaining({ validation: 'excluded', analysisEligible: false }));
    expect(archive.files.map((file: any) => file.path)).toEqual(['ok.txt']);
  });
  it('selects actual archive paths for a bounded analysis prompt, applies agent preferences, and retains archive text for authorized follow-up', async () => {
    resetForTests(); const archive = await inspect([{ name: 'README.md', value: 'Project overview and setup.' }, { name: 'src/auth/session.ts', value: 'export function validateSession() { return true; }' }, { name: 'package.json', value: '{"dependencies":{"safe":"1"}}' }]);
    const staged = store('owner-a', [{ filename: 'project.zip', type: 'zip', buffer: zip([{ name: 'placeholder.txt', value: 'discarded bytes' }]), extraction: archive.extraction, archive }], DEFAULTS)[0]; const record = getOwned('owner-a', staged.id); let payload: any;
    const output = await analyzeRecords({ ownerId: 'owner-a', records: [record], request: { question: 'Review authentication architecture.', maxNewTokens: 128, agentInstructions: 'Role: Security reviewer\nTone: concise' }, callModel: async (value: any) => { payload = value; return { status: 200, body: { response: 'Evidence-based review.' } }; } });
    expect(output.sources.map((source: any) => source.location)).toContain('src/auth/session.ts'); expect(output.retention).toMatch(/remain available/); expect(payload.message).toContain('src/auth/session.ts'); expect(payload.message).not.toContain('discarded bytes'); expect(payload.system_prompt).toContain('Role: Security reviewer'); expect(getOwned('owner-a', staged.id)).toBeDefined(); expect(getOwned('owner-b', staged.id)).toBeUndefined();
  });
});
