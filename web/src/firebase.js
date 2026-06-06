import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Values come from Vite env vars (VITE_ prefix = exposed to client code).
//   - local dev:   web/.env            (git-ignored)
//   - CI / Pages:  GitHub repo secrets injected at build time (see deploy.yml)
//
// NOTE: this is the *public* web config. Vite inlines it into the built bundle,
// so it is visible on the live site regardless. Real protection = Firestore
// rules + Auth + API-key restrictions, not hiding these strings.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Fail loudly with a useful message instead of a cryptic Firebase error.
if (!firebaseConfig.apiKey) {
  throw new Error(
    'Missing Firebase env vars. Copy web/.env.example to web/.env and fill it in ' +
    '(and set the matching GitHub repo secrets for deploys). See README §Firebase env.'
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
