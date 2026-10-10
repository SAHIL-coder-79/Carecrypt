const fs = require('fs');
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: 'postgres://carecrypt:change_me@localhost:5432/carecrypt' });
  await client.connect();
  console.log('Connected');
  const sql = fs.readFileSync('../database/schema.sql', 'utf8');
  await client.query(sql);
  console.log('Schema loaded');
  const seed = fs.readFileSync('../database/seed.sql', 'utf8');
  await client.query(seed);
  console.log('Seed loaded');
  const analytics = fs.readFileSync('../database/seed_analytics_demo.sql', 'utf8');
  await client.query(analytics);
  console.log('Analytics loaded');
  await client.end();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
