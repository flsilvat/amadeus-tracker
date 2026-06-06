import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setErr(e.code === 'auth/invalid-credential' ? 'Email or password not recognised.' : (e.message || 'Sign-in failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-xs bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
        <h1 className="text-lg font-bold tracking-tight">Staff travel odds</h1>
        <p className="text-xs text-stone-500 mb-5">Sign in to see your flights.</p>

        <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full border border-stone-300 rounded-lg px-3 py-2 mb-3 text-sm focus:outline-none focus:border-blue-400" />

        <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full border border-stone-300 rounded-lg px-3 py-2 mb-4 text-sm focus:outline-none focus:border-blue-400" />

        {err && <p className="text-xs text-rose-600 mb-3">{err}</p>}

        <button onClick={submit} disabled={busy}
          className="w-full btn-ink rounded-lg py-2 text-sm font-semibold transition disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
