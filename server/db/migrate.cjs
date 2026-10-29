const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { getPool } = require('./pool.cjs');

const MIGRATIONS_DIRECTORY = path.join(__dirname, 'migrations');
async function migrationFiles() {
  return (await readdir(MIGRATIONS_DIRECTORY)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name)).sort();
}
async function runMigrations({ pool = getPool(), directory = MIGRATIONS_DIRECTORY } = {}) {
  const client = await pool.connect();
  try {
    // A transaction-scoped advisory lock prevents competing Render instances from applying schema changes together.
    await client.query('SELECT pg_advisory_lock($1)', [82017007]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map(row => row.version));
    const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name)).sort();
    for (const filename of files) {
      if (applied.has(filename)) continue;
      const sql = await readFile(path.join(directory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [filename]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [82017007]).catch(() => undefined);
    client.release();
  }
}
async function migrationStatus({ pool = getPool(), directory = MIGRATIONS_DIRECTORY } = {}) {
  const files = await migrationFiles();
  try { const applied = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map(row => row.version)); return { ready: files.every(file => applied.has(file)), expected: files, applied: [...applied] }; }
  catch { return { ready: false, expected: files, applied: [] }; }
}
if (require.main === module) runMigrations().then(() => { process.stdout.write('Database migrations completed.\n'); }).catch(() => { process.stderr.write('Database migration failed.\n'); process.exitCode = 1; });
module.exports = { MIGRATIONS_DIRECTORY, migrationFiles, runMigrations, migrationStatus };
