const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: 'postgres://carecrypt_app:change_me_app@localhost:5432/carecrypt' });
  await client.connect();
  console.log('Connected');
  
  await client.query("CREATE TYPE clinical.consent_request_status AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');");
  
  await client.query(`
CREATE TABLE clinical.consent_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  clinician_id        uuid NOT NULL REFERENCES clinical.clinicians (id) ON DELETE CASCADE,
  scope               clinical.consent_scope NOT NULL,
  reason              text NOT NULL,
  requested_duration  interval,
  status              clinical.consent_request_status NOT NULL DEFAULT 'PENDING',
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES identity.users (id),
  consent_record_id   uuid REFERENCES clinical.consent_records (id),
  CONSTRAINT consent_requests_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT consent_requests_resolved_check CHECK (
    (status = 'PENDING' AND resolved_at IS NULL AND consent_record_id IS NULL AND resolved_by IS NULL) OR
    (status <> 'PENDING' AND resolved_at IS NOT NULL)
  )
);
  `);
  
  await client.query("CREATE UNIQUE INDEX consent_requests_one_pending ON clinical.consent_requests (patient_id, clinician_id) WHERE status = 'PENDING';");
  await client.query("CREATE INDEX consent_requests_patient_idx ON clinical.consent_requests (patient_id, created_at DESC);");
  
  // also add REMOTE_REQUEST to consent_channel enum!
  await client.query("ALTER TYPE clinical.consent_channel ADD VALUE 'REMOTE_REQUEST';");
  
  console.log('Migration complete');
  await client.end();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
