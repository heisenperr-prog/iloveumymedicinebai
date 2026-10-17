import { useEffect, useState, useSyncExternalStore } from 'react';
import { gateway } from '../services';

export function useDashboard() {
  const snapshot = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false; let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => { void gateway.connect().then(() => { if (!stopped) setError(''); }).catch(e => {
      if (!stopped) { setError(String(e)); retry = setTimeout(connect, 1000); }
    }); };
    connect();
    return () => { stopped = true; clearTimeout(retry); gateway.disconnect(); };
  }, []);
  return { snapshot, error, mode: gateway.mode };
}
export function useClock() { const [now, setNow] = useState(new Date()); useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []); return now; }
