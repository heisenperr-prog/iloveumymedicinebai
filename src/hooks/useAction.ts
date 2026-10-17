import { useState } from 'react';
import { ZodError } from 'zod';
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setFeedback({ message: 'Sending command…', error: false });
    try { await action(); setFeedback({ message: success, error: false }); return true; }
    catch (e) { setFeedback({ message: `Command failed: ${e instanceof ZodError ? e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ') : e instanceof Error ? e.message : 'The operation failed. Please try again.'}`, error: true }); return false; }
    finally { setBusy(false); }
  }
  return { busy, feedback, run, clear: () => setFeedback(null) };
}
