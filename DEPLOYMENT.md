# Deployment Playbook

This playbook documents the fastest path to deploy the world server and run external sync tests.

## Required Environment Variables

- `DATABASE_URL` - PostgreSQL connection string.
- `WORLD_SERVER_URL` (or `BASE_URL`) - public URL for the world server.
- `CITY_API_KEY` - API key used by sync workflow.
- `CITY_ID` - city target for blueprint pushes.

## Local Validation Before Deploy

1. `npm run generate:types`
2. `npm run test`
3. `cargo test`
4. `npm run bootstrap:local`

## Railway (Recommended First)

1. Create a Railway project and add a PostgreSQL service.
2. Add app service from this repo.
3. Set env vars:
   - `DATABASE_URL` from Railway Postgres.
   - `PORT=3000`
4. Build command:
   - `npm ci && npm run generate:types && npm run build --workspace @city-building/web && npm run build --workspace @city-building/world-server`
5. Start command:
   - `npm run migrate --workspace @city-building/world-server && npm run start --workspace @city-building/world-server`

## Fly.io (CLI-Centric)

1. `fly launch --name city-building-world --no-deploy`
2. `fly postgres create --name city-building-db`
3. Attach DB and set secrets:
   - `fly secrets set DATABASE_URL=...`
4. Deploy:
   - `fly deploy`

## Render + Neon/Supabase

1. Create managed Postgres on Neon or Supabase.
2. Create Render Web Service from this repo.
3. Configure env vars:
   - `DATABASE_URL`
   - `PORT=3000`
4. Build/start commands (same as Railway).

## Operational Commands

- Run DB migrations:
  - `npm run migrate --workspace @city-building/world-server`
- Run server:
  - `npm run start --workspace @city-building/world-server`
- Bootstrap first city:
  - `WORLD_SERVER_URL=https://<your-server> npm run bootstrap:local`

## GitHub Sync Workflow Secrets

For `.github/workflows/sync.yml`, configure:

- `CITY_API_KEY`
- `WORLD_SERVER_URL`
- `CITY_ID`
