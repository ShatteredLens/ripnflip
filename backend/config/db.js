const { Pool } = require('pg');

// Railway provides DATABASE_URL automatically when you attach a Postgres plugin
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected database error', err);
});

module.exports = pool;
