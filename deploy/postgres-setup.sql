-- One-time PostgreSQL setup (run as the postgres superuser):
--   sudo -u postgres psql -v owner_pw="'<OWNER_DB_PASSWORD>'" -v app_pw="'<APP_DB_PASSWORD>'" -f deploy/postgres-setup.sql
-- Two roles: the schema owner (migrations/backups) and the least-privilege application role.
\set ON_ERROR_STOP on
CREATE ROLE catalog_owner LOGIN PASSWORD :owner_pw;
CREATE ROLE catalog_app   LOGIN PASSWORD :app_pw;
CREATE DATABASE catalog OWNER catalog_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE catalog FROM PUBLIC;
GRANT CONNECT ON DATABASE catalog TO catalog_owner, catalog_app;
\connect catalog
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO catalog_owner;
