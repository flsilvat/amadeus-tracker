export const LOCAL_MODE = import.meta.env.VITE_LOCAL_MODE === 'true';
export const LOCAL_API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3737').replace(/\/$/, '');

export async function localFetch(path, options = {}) {
  const response = await fetch(`${LOCAL_API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Local API returned ${response.status}`);
  return body;
}

export function pollLocal(load, cb, onError, intervalMs = 5000) {
  let active = true;
  const run = async () => {
    try {
      const value = await load();
      if (active) cb(value);
    } catch (err) {
      if (active) onError?.(err);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  return () => { active = false; clearInterval(timer); };
}
