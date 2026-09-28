# Troubleshooting

Common problems when running CareCrypt locally. Test accounts and the shared demo password
are in [DEVELOPMENT.md](DEVELOPMENT.md#test-accounts).

## Backend will not start

**Error mentions `JWT_SECRET`.** The server refuses to start if `JWT_SECRET` is missing,
shorter than 32 characters, or a known placeholder. Generate one and put it in `backend/.env`:

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**`.env` file not found.** Create it from the example:

```
cd backend
Copy-Item .env.example .env      # PowerShell
cp .env.example .env             # macOS, Linux, Git Bash
```

**Port 4000 already in use.** Another process holds the port. Either stop it, or set a
different `PORT` in `backend/.env` and set `VITE_API_PROXY_TARGET` in `frontend/.env` to match
(for example `http://localhost:4001`).

## Frontend cannot reach the backend

- Start the backend first (`cd backend`, `npm run dev`), then check
  <http://localhost:4000/api/health>. It should return `{"status":"ok","service":"carecrypt-backend"}`.
- The health check works without a database, so a healthy response does not prove the
  database is set up. Run `npm run db:check` in `backend/` for that.
- If you change the frontend port (`VITE_DEV_PORT`), add the new origin to `CORS_ORIGINS`
  in `backend/.env`, then restart the backend.
- After editing any `.env` file, restart the server. Values are read at startup.

## Database problems

**`psql` is not recognised (Windows).** Add the PostgreSQL `bin` folder (for example
`C:\Program Files\PostgreSQL\<version>\bin`) to your PATH, or run `psql` by its full path.

**`npm run db:check` fails.** Check that PostgreSQL is running and that `DATABASE_URL` in
`backend/.env` uses the `carecrypt_app` login. Run the four setup commands in the README
[Database](../README.md#database) section in order; they depend on each other.

**Login works but analytics pages fail.** Analytics use a separate restricted login. Set
`ANALYTICS_DATABASE_URL` (the `carecrypt_analytics` login) in `backend/.env`.

## Login problems

**Wrong password or account locked.** Five wrong passwords lock an account for 15 minutes.
Wait, or reset it in the database:

```
UPDATE identity.users SET failed_login_count = 0, locked_until = NULL WHERE email = '...';
```

**Suddenly signed out.** Tokens last 1 hour, and the session is kept in `sessionStorage`,
so closing the tab also ends it. Sign in again.

**"429 Too many requests".** More than 20 login attempts from one IP in 15 minutes. Wait, or
raise `LOGIN_RATE_LIMIT_MAX` in `backend/.env` for local work.

## Getting a 403 is not always a bug

The frontend does not hide pages by role. Opening another role's page shows the server's
refusal on purpose, as a demonstration that the server enforces access. A clinician also gets
403 `NO_ACTIVE_CONSENT` for any patient who has not granted consent.

## Tests

**Analytics tests are skipped.** Without `ANALYTICS_DATABASE_URL` they are skipped. Set it
for one run:

```
# PowerShell
$env:ANALYTICS_DATABASE_URL = "postgres://carecrypt_analytics:<password>@localhost:5432/carecrypt"
npm test

# macOS, Linux, Git Bash
ANALYTICS_DATABASE_URL=postgres://carecrypt_analytics:<password>@localhost:5432/carecrypt npm test
```

**Tests fail with unexpected counts.** You probably loaded `seed_analytics_demo.sql`. The tests
expect the base seed only. Re-run `schema.sql` and `seed.sql`.

**Database is no longer clean.** Tests add audit entries and visits, and audit entries cannot
be removed. Re-run `schema.sql` and `seed.sql` for a clean state.

## Windows and PowerShell notes

- Commands in the docs written with `VAR=value command` or `$(...)` are bash syntax. In
  PowerShell use `$env:VAR = "value"` as shown above, or run the commands in Git Bash.
- In Windows PowerShell, `curl` is an alias for `Invoke-WebRequest`. Use `curl.exe` to get the
  real curl:

```
  curl.exe http://localhost:4000/api/health
```

## QR demo cards

- `npm run qr:cards` writes `backend/demo-qr-cards/index.html`. The folder is git-ignored
  because it holds live tokens.
- Re-running `seed.sql` invalidates the printed cards. Run `npm run qr:cards` again.
- The command refuses to run when `NODE_ENV=production`.