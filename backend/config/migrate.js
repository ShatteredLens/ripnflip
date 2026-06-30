// Run with: npm run migrate
// Applies database/schema.sql to whatever DATABASE_URL points at.
// Safe to run once during initial Railway setup.

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Running migration against connected database...');
  try {
    await pool.query(sql);
    console.log('✓ Migration complete. All tables created.');
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
