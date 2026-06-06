# amadeus-tracker — web frontend

Mobile-first React app that shows your staff-travel standby/upgrade odds, reading
live flight loads from the Firestore mirror your local tracker service writes.

**Live site (after first deploy):** https://flsilvat.github.io/amadeus-tracker/

---

## 1. Repo layout — yes, two of some things is fine

You said you already have `web/` inside `amadeus-tracker/`. That's exactly right.
The intended layout:

```
amadeus-tracker/                     ← your existing repo
├── .github/workflows/deploy.yml     ← build+publish web/ (must be at repo ROOT)
├── firestore.rules                  ← backend's rules (see §4)
├── package.json                     ← backend (Node tracker service)
├── node_modules/                    ← backend deps      (git-ignored)
├── .gitignore                       ← backend's ignore
├── service-account.json             ← SECRET, git-ignored (see §5)
└── web/                             ← this app
    ├── package.json                 ← frontend
    ├── node_modules/                ← frontend deps     (git-ignored)
    ├── .gitignore                   ← frontend's ignore
    ├── index.html
    └── src/…
```

**Two `.gitignore` files and two `node_modules` is normal and not a problem.** Each
`.gitignore` only applies to its own folder and below, and each ignores its own
`node_modules`. Neither `node_modules` should ever be committed — confirm with:

```bash
git status --ignored        # both node_modules should appear under "Ignored files"
git ls-files | grep node_modules   # should print NOTHING
```

If a `node_modules` was accidentally committed weeks ago, untrack it once:

```bash
git rm -r --cached node_modules web/node_modules
git commit -m "stop tracking node_modules"
```

**What actually gets deployed:** you push the *whole* repo to GitHub, but the Pages
workflow builds **only `web/`** and publishes `web/dist`. Your Node service sits in the
same repo untouched and is never served by Pages.

---

## 2. Put the workflow in the right place

The deploy file must live at the **repo root**, not inside `web/`:

```
amadeus-tracker/.github/workflows/deploy.yml      ✅
amadeus-tracker/web/.github/…                      ❌ (GitHub ignores it here)
```

This is the single most common reason a Pages deploy "does nothing" — double-check the
path. The provided `deploy.yml` already does `working-directory: web` and publishes
`web/dist`, so it expects the layout above.

---

## 3. Deploy to GitHub Pages — step by step

1. **Copy the files in** (if not already): `.github/` to the repo root, app into `web/`.
2. **Commit and push to `main`:**
   ```bash
   git add .github web
   git commit -m "add web frontend + pages deploy"
   git push origin main
   ```
3. **Turn Pages on (one time):** GitHub → your repo → **Settings → Pages →
   Build and deployment → Source: “GitHub Actions”.** (Do NOT pick “Deploy from a branch”.)
4. **Watch it build:** repo → **Actions** tab → the “Deploy web to GitHub Pages” run.
   It has two jobs, `build` then `deploy`; both should go green in ~1–2 min.
5. **Open it:** https://flsilvat.github.io/amadeus-tracker/
6. **After that it's automatic** — every push that changes anything under `web/`
   (or the workflow) rebuilds and redeploys. You can also trigger it by hand from the
   Actions tab via **“Run workflow”**.

> ℹ️ **Public vs private repo.** Free GitHub Pages requires a **public** repo. If yours
> is private and you're not on a paid plan, either make it public (see §5 first!) or
> upgrade. If it's already public, fine — just read §5.

If a deploy fails, open the failed job in the Actions tab; it's almost always either the
workflow path (§2) or Pages source not set to “GitHub Actions” (step 3).

---

## 4. Firestore rules — ⚠️ you MUST update these

Your `firestore.rules` (in the repo root, from the tracker service) currently allows
`groups`, `flights`, `observations`, and **denies everything else**. The web app writes a
new collection, **`appState/{uid}`** (favorites, per-pax confirmations, pass-code
overrides). Without a rule for it, those saves silently fail.

The corrected `firestore.rules` adds this block (already updated in your file):

```
match /appState/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

**Deploy the updated rules** one of two ways:

- **Firebase console (quickest):** console.firebase.google.com → your project →
  **Firestore Database → Rules** → paste the contents of `firestore.rules` → **Publish.**
- **CLI (if you used it before):** from the folder with `firebase.json`,
  `firebase deploy --only firestore:rules`.

You can verify in the console's **Rules Playground**: simulate an authenticated
`get`/`write` on `appState/<your-uid>` — it should **Allow**.

---

## 5. Double-check list (the stuff you set up a few weeks ago)

Back then you wired the **backend**, which talks to Firestore with a **service account**
and bypasses Auth + rules. The **frontend is the first thing that needs real user login**,
so a couple of these are probably *not* done yet:

- [ ] **Email/Password sign-in is enabled.** Console → **Authentication → Sign-in method**
      → Email/Password → **Enabled**. *(Likely NOT done — the backend never needed it.)*
- [ ] **A user account exists.** Console → **Authentication → Users → Add user** (email +
      password). This is what you'll log in with. *(Likely NOT done yet.)*
- [ ] **Updated `firestore.rules` published** with the `appState` block (§4).
- [ ] **`service-account.json` is git-ignored and NOT in the repo / git history.** This is
      your Firebase **admin** key — if the repo is public, treat a committed key as
      compromised and rotate it (console → Project settings → Service accounts).
      Check: `git ls-files | grep service-account` must print nothing.
- [ ] **The frontend `firebaseConfig`** (in `web/src/firebase.js`) matches this project —
      it does; this one is the *public* web config and is safe to commit.
- [ ] **Firestore actually has data.** Run your tracker service so it mirrors at least one
      group/flight/observation. No data ≠ broken app (see next).
- [ ] **Pages Source = “GitHub Actions”** and the workflow file is at the repo root (§2–3).

**Sanity check without any of the above:** append `?demo=1` to the URL
(`https://flsilvat.github.io/amadeus-tracker/?demo=1`) — it skips auth and live data and
renders sample flights, so you can confirm the deploy itself worked independently of
Firebase. If `?demo=1` looks right but signing in shows no trips, that just means the
service hasn't mirrored a group to Firestore yet.

---

## 6. Local development

```bash
cd web
npm install
npm run dev
```

- Sign in with the Firebase user from §5 to see live data.
- Preview without auth/live data: open `http://localhost:5173/amadeus-tracker/?demo=1`.

Build locally to mirror what CI does: `npm run build` then `npm run preview`.

---

## How it works (reference)

- **Odds engine** (`src/lib/odds.js`) — pure logic. Clearance runs in one pass in
  queue-priority order; each person ahead takes their entitled cabin (downgrading if full),
  then we see what's left for you. Blue = First/Club, amber = on but economy/eco+, red =
  unlikely.
- **Data** (`src/lib/data.js`) — live `onSnapshot` subscriptions to `groups`, `flights`,
  `observations` (single-field filters → no composite indexes needed); latest observation
  per flight picked client-side.
- **Duration** (`src/lib/time.js`) — backend stores only local dep/arr times, so flight
  time and the `+1` day marker are derived from each airport's timezone. Add missing
  stations to `AIRPORT_TZ`. (If you later store `durationMin`/`arrDayOffset` on the flight
  doc, the app uses those directly.)
- **Your state** (`src/hooks/useAppState.js`) — favorites, confirmations, and pass-code
  overrides persist per user at `appState/{uid}`, syncing across your devices.
