# Six-hour expiry for unaccepted assistance requests

Only `PENDING` requests with no assigned driver expire. The deadline is exactly
`createdAt + 6 hours`; polling, location updates and reopening an app do not extend
it. Accepted, arrived, completed and cancelled requests are unaffected. Records
are retained with the new `EXPIRED` status rather than deleted.

The available-request query excludes elapsed requests immediately. Acceptance
uses the same deadline in its atomic conditional update, so a stale card cannot
bypass expiry. Customer list/detail responses also represent elapsed unassigned
requests as expired before the background sweep commits their persisted status.

At API startup and every 15 seconds, a bounded batch of 200 due rows is locked
with `FOR UPDATE SKIP LOCKED`, updated and paired with durable outbox events in
one database transaction. Concurrent sweepers skip locked rows. Failed outbox
writes roll back expiration; the next interval retries. The existing outbox
worker notifies customers. Driver polling and a local deadline timer remove
pending cards without a manual reload, including when the page remains open.
Server validation remains authoritative for acceptance.

Expired requests cannot start new service payments or submit legacy transfers.
If a due request already has a submitted, verified or pending-gateway payment,
the sweep preserves its records and marks it `REFUND_REQUIRED` for review. Late
successful provider callbacks also enter refund review rather than crediting a
driver. This does not issue an automatic bank refund or change wallet top-ups.

The customer and driver clients recognize `EXPIRED` as terminal; tracking ends.
The customer history retains its record with an expiry label. The admin panel
also labels and filters expired requests.

## Deployment

Deploy the matching customer, driver, admin and API changes. Apply migration
`202611210001_request_expiry` and regenerate the Prisma client before running the
new backend. The repository's production Dockerfile already runs migrations
before `src/server.js`; rebuilding the image regenerates Prisma.

For a non-Docker deployment from the backend directory:

```sh
npm ci
npx prisma generate
npx prisma migrate deploy
npm start
```

Existing old pending requests become ineligible immediately upon the updated API
serving queries. Persistence catches up in bounded batches. No APK re-signing,
package-name change, account reset or data deletion is needed.

## Driver modules

The existing home layout, cards and navigation labels remain, with the requested
rename from Iran Shahr to `اعلام بار`. Entries for unfinished announcement,
parts purchasing, technical/insurance services, training, maintenance, referral,
support and notifications show the shared-style accessible completion dialog.
Actual wallet, profile saving, identity-document upload, availability and request
operations continue to work. Placeholder profile settings, vehicle actions and
shift/range saving also use the completion dialog.
Unsupported document types also open the dialog before opening a file chooser;
the implemented national identity upload/download remains available.

## Validation

`npm test` includes `test/request-expiry.test.js`: exact deadline, assignment
safety, real PostgreSQL-compatible migration/sweep, batch limits, idempotency,
outbox rollback, available endpoint filtering and stale acceptance rejection.
Browser coverage is in the customer repository's `driver-expiry.spec.ts` with
`playwright.driver-expiry.config.ts`. It checks pending cards expiring while
open, accepted work remaining, unfinished-module entry points, no market API
requests, the new announcement label and retained customer expiry history.

Changes are local until deployed; no production migration was executed here.

Final local validation: 113 backend tests passed; 3 new browser tests and the
9 existing fleet regression cases passed. Customer, driver and admin production
builds passed. Full customer/driver ESLint passed, followed by targeted lint for
the final driver document handlers and browser cases. Prisma validation passed.
