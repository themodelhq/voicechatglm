import { readdirSync, readFileSync, statSync } from 'node:fs'; import { join } from 'node:path';
const skip = new Set(['node_modules', 'dist', '.git']); const files = [];
function walk(path) { for (const name of readdirSync(path)) { if (skip.has(name)) continue; const full = join(path, name); const stat = statSync(full); if (stat.isDirectory()) walk(full); else files.push(full); } }
walk('.');
const checks = [/hf_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/, /ngrok_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{30,}/]; const hits = [];
for (const file of files) { if (/\.(png|jpg|jpeg|gif|zip|lock)$/i.test(file)) continue; const text = readFileSync(file, 'utf8'); for (const check of checks) if (check.test(text)) hits.push(`${file}: ${check}`); }
if (hits.length) { console.error(hits.join('\n')); process.exit(1); } console.log('No common credential patterns found in source files.');
