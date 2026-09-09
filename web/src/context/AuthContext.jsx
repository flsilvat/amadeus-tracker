import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase.js';
import { isDemo } from '../lib/data.js';
import { LOCAL_MODE } from '../lib/local.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!isDemo() && !LOCAL_MODE);

  useEffect(() => {
    if (isDemo() || LOCAL_MODE) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const value = {
    user,
    loading,
    demo: isDemo(),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signOutUser: () => signOut(auth),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
