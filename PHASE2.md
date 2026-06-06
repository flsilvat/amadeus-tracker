# Phase 2 — Firestore mirror

Adds Firestore as a cloud mirror of the local SQLite database. SQLite stays
the source of truth; Firestore is best-effort secondary so a Firestore outage
can never break a JFE capture.

## What changed

- **New module `src/storage/firestore.js`** — Admin SDK init + mirror writers
  for groups, flights, and observations. Errors are logged but never thrown.
- **`service.js`** now calls `mirrorGroup`/`mirrorFlight`/`mirrorObservation`
  after every SQLite write (fire-and-forget).
- **`groups` table** gained `my_stf_code` and `my_doj` columns. Existing
  databases auto-migrate on startup.
- **New endpoint** `GET /flights/:id/my-position` returns where the group's
  configured STF code would sit in that flight's current queue.
- **New script** `npm run test:firestore` — round-trip smoke test for the
  Firestore connection without touching JFE.
- **`firestore.rules`** — deploy these in Firebase Console (Firestore →
  Rules tab → paste contents → Publish) so only authenticated users can read.

## Setup

After creating the Firebase project (see the chat for the 5-step walkthrough):

1. Drop `service-account.json` in the project root. It's already gitignored.
2. In `.env`, set:
   ```
   FIRESTORE_ENABLED=true
   FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
   ```
3. Install the new dep:
   ```powershell
   npm install
   ```
4. Smoke-test the connection (writes/reads/deletes a tiny doc):
   ```powershell
   npm run test:firestore
   ```
5. Deploy the security rules — open Firebase Console → Firestore → Rules tab,
   paste the contents of `firestore.rules`, click **Publish**.

## Group creation now accepts the per-trip STF code

```powershell
Invoke-RestMethod -Uri http://localhost:3737/groups -Method POST `
  -ContentType 'application/json' `
  -Body (@{
    id = 'trip-sea-jul-26'
    name = 'Seattle, late July'
    outbound = @{ origin = 'LHR'; destination = 'SEA'; date = '2026-07-15' }
    inbound  = @{ origin = 'SEA'; destination = 'LHR'; date = '2026-07-29' }
    myStfCode = '53B/J45'
    myDoj = '15JUN23'
  } | ConvertTo-Json)
```

Both `myStfCode` and `myDoj` are optional — the group works fine without them,
but the `my-position` endpoint will 404 until they're set.

## Verify the mirror is firing

After a refresh:

```powershell
curl http://localhost:3737/groups/trip-sea-jul-26/refresh -Method POST
```

…open Firebase Console → Firestore → **observations** collection and you
should see fresh documents arriving, each containing the full cabins block
and embedded queue array.
