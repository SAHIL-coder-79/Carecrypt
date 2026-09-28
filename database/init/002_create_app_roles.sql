-- CareCrypt runtime database roles.
-- Run once as a PostgreSQL superuser, after 001_create_role_and_database.sql:
--   psql -U postgres -f database/init/002_create_app_roles.sql
--
-- Role model (defence in depth for "ADMIN must not see identifiable patient data"):
--   carecrypt            owns every object; used only to run schema.sql and seed.sql
--   carecrypt_app        used by the API for clinical, identity, consent and audit work
--   carecrypt_analytics  used by the API for ADMIN analytics endpoints. It can read the
--                        aggregate, suppressed views in the "analytics" schema and nothing
--                        else, so even a bug in an admin endpoint cannot read a patient row.
--
-- schema.sql grants privileges to these roles if they exist.
-- Change the passwords here and in backend/.env to match.

CREATE ROLE carecrypt_app WITH LOGIN PASSWORD 'change_me_app';
CREATE ROLE carecrypt_analytics WITH LOGIN PASSWORD 'change_me_analytics';

GRANT CONNECT ON DATABASE carecrypt TO carecrypt_app, carecrypt_analytics;
