import { Activity, Bell, Box, CalendarDays, ChevronRight, Cpu, History, LayoutDashboard, Menu, Plus, Settings2, ShieldCheck, SlidersHorizontal, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Snapshot } from '../types';
import { Badge } from '../components/ui';
import { date, seconds } from '../utils/time';
import { gateway } from '../services';

export const pages = [
  { id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard },
  { id: 'schedules', title: 'Medicine Schedule', icon: CalendarDays },
  { id: 'monitoring', title: 'Live Monitoring', icon: Activity },
  { id: 'alerts', title: 'Alerts', icon: Bell },
  { id: 'history', title: 'Medicine History', icon: History },
  { id: 'control', title: 'Device Control', icon: SlidersHorizontal },
  { id: 'settings', title: 'Settings', icon: Settings2 },
];
export function AppLayout({ children, snapshot, page, now }: { children: ReactNode; snapshot: Snapshot; page: string; now: Date }) {
  const [menu, setMenu] = useState(false);
  const demo = gateway.mode === 'demo';
  const displayedDate = demo ? date(now) : snapshot.device.deviceDate ?? 'Not reported';
  const displayedTime = demo ? seconds(now) : snapshot.device.deviceTime ?? 'Not reported';
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); };
    if (menu) window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [menu]);
  const activeAlerts = snapshot.alerts.filter(a => !a.acknowledged && a.severity !== 'info').length;
  return <div className="app-shell">
    {menu && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
      <a href="#dashboard" className="brand" onClick={() => setMenu(false)}><span className="brand-mark"><Plus size={25} strokeWidth={3} /></span><span>medibox<span className="brand-sub">SCADA CONTROL CENTER</span></span></a>
      <button className="mobile-close icon-button" onClick={() => setMenu(false)} aria-label="Close navigation"><X size={20} /></button>
      <div className="nav-label">WORKSPACE</div>
      <nav>{pages.map(item => <a key={item.id} href={`#${item.id}`} aria-current={page === item.id ? 'page' : undefined} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setMenu(false)}><item.icon size={18} /><span>{item.title}</span>{item.id === 'alerts' && activeAlerts > 0 && <span className="nav-count">{activeAlerts}</span>}{page === item.id && <ChevronRight size={15} className="nav-chevron" />}</a>)}</nav>
      <div className="sidebar-device"><div className="flex items-center gap-2"><Cpu size={18} /><span>CONNECTED DEVICE</span></div><strong>{snapshot.settings.deviceName}</strong><div className="flex items-center justify-between"><span className="mono muted">ESP32-WROOM</span><Badge tone={snapshot.device.online ? 'green' : 'muted'} dot>{snapshot.device.online ? 'Online' : 'Offline'}</Badge></div><div className="device-line" /><p>Smart Medicine Reminder Box<br />with Compartment Alert System</p></div>
      <div className="sidebar-footer"><span className="avatar">AD</span><div><strong>Administrator</strong><small>{demo ? 'Local demo session' : 'Backend connection'}</small></div><ShieldCheck size={17} className="muted" /></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="flex items-center gap-3"><button className="mobile-menu icon-button" onClick={() => setMenu(true)} aria-label="Open navigation"><Menu size={21} /></button><span className="topbar-title">Smart Medicine Reminder Box</span><span className="topbar-divider" /><Badge tone={demo ? 'amber' : 'blue'}>{demo ? 'DEMO MODE' : 'REAL DEVICE MODE'}</Badge></div><div className="topbar-right"><span className={`connection ${snapshot.device.online ? 'text-green' : 'muted'}`}>{snapshot.device.online ? <Wifi size={15} /> : <WifiOff size={15} />}{snapshot.device.online ? 'ONLINE' : 'OFFLINE'}</span><span className="mono ip-address">{snapshot.device.ipAddress}</span><span className="topbar-divider" /><span className="top-date">{displayedDate}</span><strong className="mono clock">{displayedTime}</strong><span className="avatar small">AD</span></div></header>
      <main id="main-content">{children}</main>
      <footer className="main-footer"><span><Box size={13} /> SMART MEDICINE BOX <span className="muted">/</span> THESIS PROJECT</span><span>{demo ? 'Demo data' : 'Live device data'} · device events only · v1.0</span></footer>
    </div>
  </div>;
}
