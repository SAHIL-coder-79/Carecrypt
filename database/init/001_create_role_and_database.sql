-- CareCrypt local development database.
-- Run once as a PostgreSQL superuser, for example:
--   psql -U postgres -f database/init/001_create_role_and_database.sql
--
-- Change the password here and in backend/.env (DATABASE_URL) to match.

CREATE ROLE carecrypt WITH LOGIN PASSWORD 'change_me';
CREATE DATABASE carecrypt OWNER carecrypt;
