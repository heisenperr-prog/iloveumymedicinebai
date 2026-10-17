import { useEffect, useState } from 'react';
import { AppLayout, pages } from './layouts/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Schedules } from './pages/Schedules';
import { Monitoring } from './pages/Monitoring';
import { Alerts } from './pages/Alerts';
import { History } from './pages/History';
import { Control } from './pages/Control';
import { Settings } from './pages/Settings';
import { Busy } from './components/ui';
import { useClock, useDashboard } from './hooks/useDashboard';
import { switchDeviceMode } from './services';

function currentPage() { const value = location.hash.slice(1).split('/')[0]; return pages.some(p => p.id === value) ? value : 'dashboard'; }
export default function App() {
  const { snapshot, error } = useDashboard();
  const now = useClock();
  const [page, setPage] = useState(currentPage);
  useEffect(() => { const update = () => { setPage(currentPage()); window.scrollTo(0, 0); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { document.title = `${pages.find(p => p.id === page)?.title} · Medibox SCADA`; }, [page]);
  if (error) return <div className="startup-error" role="alert"><h1>Controller unavailable</h1><p>{error} Retrying automatically.</p><div className="flex gap-2"><button className="button primary" onClick={() => location.reload()}>Retry</button><button className="button" onClick={() => switchDeviceMode('demo')}>Use demo mode</button></div></div>;
  if (!snapshot) return <Busy />;
  const views = { dashboard: <Dashboard snapshot={snapshot} now={now} />, schedules: <Schedules snapshot={snapshot} />, monitoring: <Monitoring snapshot={snapshot} />, alerts: <Alerts snapshot={snapshot} />, history: <History snapshot={snapshot} />, control: <Control snapshot={snapshot} />, settings: <Settings snapshot={snapshot} /> };
  return <AppLayout snapshot={snapshot} page={page} now={now}>{snapshot.integration?.lastError && <div className="feedback error" role="alert">{snapshot.integration.lastError} Automatic retries are active.</div>}{snapshot.integration && snapshot.integration.missingTelemetry.length > 0 && <div className="notice">Firmware does not report: {snapshot.integration.missingTelemetry.join(", ")}. These values are Unknown; no demo data is substituted.</div>}{snapshot.storageWarning && <div className="feedback error" role="alert">{snapshot.storageWarning}</div>}{views[page as keyof typeof views]}</AppLayout>;
}
