import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
if (!existsSync('dist')) throw new Error('Build output is missing. Run npm run build before scanning bundles.');
const files = []; function walk(directory) { for (const name of readdirSync(directory)) { const full = join(directory, name); const stat = statSync(full); if (stat.isDirectory()) walk(full); else files.push(full); } } walk('dist');
const checks = [/hf_[A-Za-z0-9_-]{20,}/, /sk-[A-Za-z0-9_-]{20,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{20,}/, /(?:AKIA|ASIA)[0-9A-Z]{16}/, /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\s*\r?\n[A-Za-z0-9+/=]{32,}/]; const hits = [];
for (const file of files) { if (/\.(png|jpg|jpeg|gif|webp|ico)$/i.test(file)) continue; const text = readFileSync(file, 'utf8'); for (const check of checks) if (check.test(text)) hits.push(`${file}: credential pattern ${check}`); }
if (hits.length) { console.error(hits.join('\n')); process.exit(1); }
console.log('No common credential patterns found in built assets.');
