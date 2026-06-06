import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Public web config — safe to ship in client code. Access is gated by Firebase
// Auth + Firestore security rules, not by hiding this object.
const firebaseConfig = {
  apiKey: 'AIzaSyDQSRQ4m_UwrGh73OWPHwDRLmYGAS3Ncx8',
  authDomain: 'amadeus-tracker-e096c.firebaseapp.com',
  projectId: 'amadeus-tracker-e096c',
  storageBucket: 'amadeus-tracker-e096c.firebasestorage.app',
  messagingSenderId: '342294400102',
  appId: '1:342294400102:web:fe0bda178c2a31fb7531a7',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
