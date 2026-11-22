# Customer phone authentication

Only the customer application changes. Driver registration and password authentication remain unchanged. Existing customer password logins and sessions remain supported.

## Server configuration

Set these in the backend `.env`, never in NEXT_PUBLIC variables:

```dotenv
NIAZPARDAZ_API_KEY=your-server-side-key
NIAZPARDAZ_SENDER=10009611
# Optional independent random secret, minimum 32 characters:
# OTP_HMAC_SECRET=...
```

The default message exactly matches the supplied template:

```text
کد تأیید شما برای ورود به اپلیکیشن خودروچاره:
{code}
لطفاً این کد را در اختیار دیگران قرار ندهید.
```

Official documentation: https://niazpardaz-sms.com/webservice and https://github.com/NiazpardazSms/niazpardaz-sms-js

The official `niazpardazsms` SDK's `send(sender, recipient, text)` accepts full text, not a pattern identifier. Pattern approval is required on the provider account for the shared sender. No undocumented pattern endpoint is assumed. The SDK default REST base is `https://login.niazpardaz.ir/api/v2/RestWebApi`; if your account's webservice guide specifies a different HTTPS REST base, set `NIAZPARDAZ_BASE_URL` to that base (without `/SendBatchSms`). Do not use the public documentation page URL as the REST base. `NIAZPARDAZ_OTP_TEMPLATE` optionally overrides the exact approved text; it must include `{code}` and accepts escaped `\n` newlines. Provider rejection, including unapproved template, returns failure rather than admitting a user.

## Deploy

1. Install locked dependencies with `npm ci` and generate Prisma client with `npm run prisma:generate`.
2. Back up the database using the existing deployment procedure, then run `npm run db:migrate` before starting the new backend.
3. Restart the backend with the server environment above; build and deploy the customer app using its existing pipeline. No driver frontend deployment is needed.
4. Test on an authorized recipient: request a signup code, verify it, complete identity information when opening a service, then test password login, OTP login and password recovery. Check actual SMS delivery and provider approval. Never log keys, message codes or full provider payloads.

Without a configured key, OTP endpoints honestly return 503; existing password login remains available. Local tests use an injected SMS provider and do not send paid messages. Actual delivery and shared-line template acceptance have not been verified without credentials.

## Behavior and security

- `/register` collects only a phone number and an OTP; `/login-otp` supports existing customers; `/forgot-password` verifies OTP and changes the password atomically.
- New users enter the home page immediately after phone verification. Module access redirects to `/complete-profile`, which collects name, valid national-ID checksum and a password, then returns to the requested module. Server authorization also enforces completion. This is phone verification plus validated profile information, not government identity verification.
- Existing complete customer profiles need no additional form. The old full-registration HTTP endpoint returns 410 and cannot bypass OTP.
- Six-digit cryptographically random codes expire after five minutes, are single-use, and are stored only as keyed hashes. Purpose binding prevents a reset code being used to log in.
- Five incorrect attempts lock a challenge. Resends wait 60 seconds; a phone is limited to five sends/hour and ten/day, plus IP rate limits. Failed sends count towards limits. Concurrent verification cannot create multiple sessions with the same code.
- Password reset revokes all sessions and active sockets for that customer, leaving driver sessions untouched. Existing identity and account data are retained.
- Nullable customer identity/password fields support deferred completion; the database keeps a constraint requiring them for drivers. Old users are not rewritten.
- Expired OTP records are cleaned at startup and hourly, after a two-day retention period for rate-limit history. No OTP or password is stored in browser storage.

## Verification

`npm test` includes the real OTP migration, PostgreSQL-compatible PGlite transactions, Prisma, HTTP authentication, failed-attempt persistence, concurrent replay, provider failures, profile completion, reset revocation and driver isolation. In the customer app run `npm run build`, `npm run lint`, and `npx playwright test --config playwright.auth.config.ts`; tests cover mobile/desktop signup, deferred profile, recovery and temporary OTP sessions using mocked HTTP only.

Local verification on 2026-11-22: all 115 backend tests passed; Prisma validation, customer production build, TypeScript, ESLint and both brand-asset tests passed. All 24 existing customer browser regression tests and the four new browser authentication tests passed at mobile and desktop sizes, including returning to the real roadside form after identity completion. The separately enabled PostGIS/Redis infrastructure lifecycle test was skipped because its isolated external test services were not enabled; the OTP test exercised its actual migration and Prisma against a PostgreSQL-compatible PGlite instance. No production migration or live SMS was performed.
