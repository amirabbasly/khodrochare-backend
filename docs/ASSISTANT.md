# Automotive assistant

Both customer and driver clients call the authenticated backend, never GapGPT directly. Set `GAPGPT_API_KEY` in the backend server environment and recreate the API container. Do not use a NEXT_PUBLIC variable. Optional settings: `GAPGPT_MODEL=gpt-4o`, `ASSISTANT_SUPPORT_PHONE=09123022064` (the phone from the supplied integration). The existing departmental support page retains its own 02182801043 phone.

`GET /api/v1/assistant/config` returns the support phone and provider readiness (`enabled`), never credentials. `POST /api/v1/assistant/chat` accepts `{messages:[{role:"user",content:"..."}]}` with user/assistant roles only, last message user, 1?20 messages, 4000 characters each, 20000 total, JSON payload at most 50000 UTF-8 bytes. The backend injects its own automotive safety/identity prompt and appends the configured support suffix once. Redis limits each authenticated user to 10 submissions per 300 seconds across both apps. Upstream timeout is 30 seconds; client timeout 35 seconds. Disconnects abort the upstream call. Errors never include credentials or pretend a completion succeeded.

The supplied support-phone FAQ works without provider credentials. Other questions return an explicit unavailable response until credentials are configured. UI preserves failed questions and retries the same conversation. No database migration is required.

Validation: `npm test` includes mocked GapGPT contract and actual Express HTTP authentication, byte limits, role validation and shared rate-limit coverage. Live GapGPT verification requires the server key and was not performed locally.

## Diagnose deployed HTTP 503

In this implementation a chat HTTP 503 means GAPGPT_API_KEY is absent from the API process (provider failures use 502). GET /assistant/config now includes a public enabled boolean; no key is exposed. Whitespace around credentials is trimmed.

The Compose API service loads khodrochare-backend/.env via env_file. Put the key there on the server, never in the frontend env. After changing the env file, recreate the API container to load it:

    docker compose up -d --build --force-recreate api
    docker compose exec -T api node scripts/check-assistant.js

After deploying this version, `--probe` runs one actual provider request and reports only success/status, not credentials or message text:

    docker compose exec -T api node scripts/check-assistant.js --probe

Compose docs: https://docs.docker.com/reference/cli/docker/compose/up/

The API Compose service also explicitly forwards GAPGPT_API_KEY, GAPGPT_MODEL and ASSISTANT_SUPPORT_PHONE, so exporting these on the server is honored as well as the backend .env file. Model and phone defaults match the original integration.
