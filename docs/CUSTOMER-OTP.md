# Customer phone authentication

Customer OTP login also creates new customer accounts. Fleet registration requires its full profile plus a phone-bound OTP; registered drivers can use a password or OTP and recover their password. Existing password accounts and sessions remain supported.

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

Production incident resolved on 2026-11-22: the configured `login.niazpardaz.ir` endpoint returned ArvanCloud HTML HTTP 403 (IP/location denied) from both host curl and container Node. With the account owner's explicit approval, the alternative REST base listed in the provider documentation was validated using GetCredit and a real SMS send. This deployment now uses `NIAZPARDAZ_BASE_URL=https://www.payamak.vip/api/v2/RestWebApi` with the existing SDK transport. The public OTP endpoint returned HTTP 200 with a five-minute challenge, and its persisted state was SENT. Preserve that environment setting during redeployments; do not reset it to the SDK default. Provider acceptance was verified; handset delivery and entering the received code require the recipient. No credentials belong in this document.

1. Install locked dependencies with `npm ci` and generate Prisma client with `npm run prisma:generate`.
2. Back up the database using the existing deployment procedure, then run `npm run db:migrate` before starting the new backend.
3. Restart the backend with the server environment above; build and deploy the customer app using its existing pipeline. Deploy the updated driver frontend too when enabling fleet OTP.
4. Test on an authorized recipient: request a signup code, verify it, complete identity information when opening a service, then test password login, OTP login and password recovery. Check actual SMS delivery and provider approval. Never log keys, message codes or full provider payloads.

Without a configured key, OTP endpoints honestly return 503; existing password login remains available. Local tests use an injected SMS provider and do not send paid messages. Production provider acceptance was verified for the approved message; handset delivery must be checked by the recipient.

## Behavior and security

### Diagnosing a 503 after a successful Postman send

Run `node scripts/check-customer-otp.js` inside the running API environment (Docker: `docker compose exec api node scripts/check-customer-otp.js`). This only inspects configuration; it sends no SMS and prints no key, recipient, code or template text. Confirm `apiKeyConfigured`, `matchesSuccessfulPostmanEndpoint`, `usesDefaultTemplate`, and sender `10009611`. The successful Postman URL matches the SDK default. Ensure the running process uses the same key as Postman; changing `.env` alone does not update an existing container's environment. Recreate the API container after configuration or code changes using the existing deployment process.

Retry the application's OTP endpoint once and inspect `docker compose logs --since=5m api` for `Customer OTP SMS:`. Only allowlisted diagnostic fields are logged: `PROVIDER_HTTP_ERROR` with HTTP status, `PROVIDER_REJECTED` with numeric result code (18 means no matching valid template), `TIMEOUT`, `DNS_ERROR`, `CONNECTION_ERROR`, or `PROVIDER_OR_NETWORK_FAILURE`. SDK error text and provider payloads are deliberately excluded because they can contain private information. A successful send is not retried automatically. These diagnostics identify failures; they do not imply a production cause has already been established.

An explicit paid SMS test using the exact production adapter is available:
`docker compose exec api node scripts/check-customer-otp.js --send-test-sms --phone=09XXXXXXXXX`.
Replace the phone with an authorized recipient. This sends one random-code message, makes no user/session/database changes, and does not create a usable login code. It prints safe acceptance/failure and duration fields, never the code or key. Default execution without flags still sends nothing. Copy `scripts/check-customer-otp.js` and `src/niazpardaz.js` to the server before rebuilding the API image; recreating an old image cannot add missing source files.

The regression test exercises the complete HTTP OTP route, real migration/Prisma and installed SDK against a local provider HTTP server. The supplied successful Postman envelope returns 200 and creates a usable challenge. A provider HTTP 403 reproduces the application's 503, records FAILED, creates no session and logs only the numeric upstream status. It does not establish why a production upstream returns 403; the production server is not available in the local workspace.

When curl succeeds but the SDK's fetch request returns 403, an opt-in native HTTPS transport is available. Upload `src/niazpardaz-https.js`, `src/niazpardaz.js`, `src/config.js` and `scripts/check-customer-otp.js`, then rebuild the API image. Test exactly one authorized message with:
`docker compose exec api node scripts/check-customer-otp.js --send-test-sms --phone=09XXXXXXXXX --transport=https`.
The override affects only this diagnostic invocation. If it succeeds, set `NIAZPARDAZ_TRANSPORT=https` in the backend `.env` and recreate the API container to use it in the actual OTP endpoint. Default is `sdk`; rollback is `NIAZPARDAZ_TRANSPORT=sdk`. Both use the same REST contract, success checks and OTP logic. Native HTTPS uses normal TLS validation, minimal non-browser headers, a full-response deadline and bounded response size. It never follows redirects or retries an SMS automatically. Local loopback tests cover wire payloads, success, 403, redirects, invalid/rejected/oversized responses, stalled bodies and transport selection. They do not prove production delivery; test the transport on the actual server before treating the issue as resolved.

- `/register` redirects to `/login-otp`, which supports existing and new customers; `/forgot-password` verifies OTP and changes the password atomically.
- New users enter the home page immediately after phone verification. Module access redirects to `/complete-profile`, which collects name, valid national-ID checksum and a password, then returns to the requested module. Server authorization also enforces completion. This is phone verification plus validated profile information, not government identity verification.
- Existing complete customer profiles need no additional form. The old full-registration HTTP endpoint returns 410 and cannot bypass OTP.
- Six-digit cryptographically random codes expire after five minutes, are single-use, and are stored only as keyed hashes. Purpose binding prevents a reset code being used to log in.
- Five incorrect attempts lock a challenge. Resends wait 60 seconds; a phone is limited to five sends/hour and ten/day, plus IP rate limits. Failed sends count towards limits. Concurrent verification cannot create multiple sessions with the same code.
- Password reset revokes all sessions and active sockets for that customer, leaving driver sessions untouched. Existing identity and account data are retained.
- Nullable customer identity/password fields support deferred completion; the database keeps a constraint requiring them for drivers. Old users are not rewritten.
- Expired OTP records are cleaned at startup and hourly, after a two-day retention period for rate-limit history. No OTP or password is stored in browser storage.

## Verification

The retained `npm test` suite covers domain, HTTP, session, Hall, payment and gateway regressions. Dedicated OTP tests exercised real migrations, PostgreSQL-compatible PGlite transactions, Prisma and HTTP before their removal at the owner's request. In the customer app run `npm run build`, `npm run lint`, and the remaining browser regression suites; tests cover mobile/desktop signup, deferred profile, recovery and temporary OTP sessions using mocked HTTP only.

Local verification on 2026-11-22: all 115 backend tests passed; Prisma validation, customer production build, TypeScript, ESLint and both brand-asset tests passed. All 24 existing customer browser regression tests and the four new browser authentication tests passed at mobile and desktop sizes, including returning to the real roadside form after identity completion. The separately enabled PostGIS/Redis infrastructure lifecycle test was skipped because its isolated external test services were not enabled; the OTP test exercised its actual migration and Prisma against a PostgreSQL-compatible PGlite instance. No production migration or live SMS was performed.


## Unified customer / fleet authentication and Hall contacts (2026-11-23)

Customer signup is part of OTP login (`/login-otp` uses REGISTER purpose so a verified new phone creates a customer account). The old customer `/register` URL redirects to OTP login and has no signup form; password login remains available. Fleet signup still requires the complete driver profile and an uploaded identity document; it additionally requires a DRIVER_REGISTER challenge bound to that exact phone. DRIVER_LOGIN cannot create an account or consume a registration/reset/customer/contact code. Driver password recovery revokes driver sessions and preserves customer sessions for the same phone.

Deploy migrations `202611230001_fleet_otp` and `202611230002_hall_contact_otp` using the standard Prisma migration deployment before starting the updated backend. Deploy both customer and driver frontends. Preserve the production NIAZPARDAZ_BASE_URL setting documented above; no extra SMS credential is needed for drivers or alternate Hall contacts.

Hall's own-phone option uses the authenticated account number without another OTP. An alternate number opens the OTP dialog after the first Continue action. A HALL_CONTACT challenge is bound to the requesting customer and listing. Successful verification records the exact phone on that listing. Both publication and editing a published contact reject an unverified alternate number; a UI bypass cannot publish it. OTP expiry, one-use consumption, attempt counters and phone/IP limits still apply. Contact verification metadata is not exposed by public listing DTOs.

Assigned request details expose only the counterpart's name, not national identity or other private profile fields. Driver and customer final totals use the stored payment amount or service plus approved parts. Commission is deducted from that total: repair 30% app / 70% driver, towing 20% app / 80% driver. It is never added on top of the customer's price. Verified live payments create one idempotent DriverEarning, included in the driver's wallet balance. Sandbox never credits real earnings. Live gateway success is displayed green only for a VERIFIED payment with a verified live checkout; the no-gateway-payment message is red. Completing a request requires verified payment as well as the existing repair operation/commission conditions. Sandbox completion is accepted only outside live gateway mode.

Before issuing an account-deletion code, the backend attempts to reconcile up to three pending gateway and three Hall callbacks for that customer against the real provider. Verification failure never marks a payment paid or cancelled. Unresolved payment/refund/review states, unpaid completed services and live wallet funds remain blockers with separate messages. Cancelled/expired unpaid services do not themselves create a debt blocker; refunds still do. Historical production data is not mass-edited or falsely settled.

At the owner's request, the dedicated recent OTP test files and standalone auth Playwright config were removed after validation; general Hall, session, payment and gateway tests remain. Validation before removal: 118 backend tests passed, the 18 Hall/session browser regressions passed, and customer/fleet authentication, recovery and deletion checks passed (one desktop deletion timeout passed on isolated rerun). No SSH connection or production deployment was performed for these code changes.
