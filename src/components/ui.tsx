import { useEffect, useRef } from 'react';
import { X, CircleCheck, CircleAlert, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function Badge({ children, tone = 'muted', dot = false }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'muted' | 'blue'; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <i />}{children}</span>;
}
export function Panel({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</div>{children}</section>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function Feedback({ value }: { value: { message: string; error: boolean } | null }) {
  if (!value) return null;
  return <div className={`feedback ${value.error ? 'error' : 'success'}`} role={value.error ? 'alert' : 'status'}>{value.error ? <CircleAlert size={17} /> : <CircleCheck size={17} />}{value.message}</div>;
}
export function Busy({ children }: { children?: ReactNode }) { return <div className="empty"><LoaderCircle className="spin" size={24} />{children || 'Connecting to demo controller…'}</div>; }
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="dialog-title" onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><div className="modal-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>{children}</dialog>;
}
export function Confirm({ title, children, confirm, close, busy = false, danger = false }: { title: string; children: ReactNode; confirm: () => void; close: () => void; busy?: boolean; danger?: boolean }) {
  return <Modal title={title} close={close}><div className="modal-copy">{children}</div><div className="modal-actions"><button className="button" onClick={close} disabled={busy}>Cancel</button><button className={`button ${danger ? 'danger' : 'primary'}`} onClick={confirm} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button></div></Modal>;
}
