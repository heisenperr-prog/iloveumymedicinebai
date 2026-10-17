import { ArrowDownLeft, ArrowUpRight, Bell, CalendarDays, ChevronRight, Clock3, Cpu, Plus, Radio, ShieldCheck } from 'lucide-react';
import type { Snapshot } from '../types';
import { Badge, Empty, Panel } from '../components/ui';
import { CompartmentCard } from '../components/CompartmentCard';
import { EventLog } from '../components/EventLog';
import { ActivityChart } from '../components/ActivityChart';
import { DemoControls } from '../components/DemoControls';
import { RealDeviceControls } from '../components/RealDeviceControls';
import { countdown, dayKey, nextSchedule, scheduleTime, seconds, time } from '../utils/time';

export function Dashboard({ snapshot: s, now }: { snapshot: Snapshot; now: Date }) {
  const activeSchedules = s.integration ? s.schedules.filter(schedule => schedule.source === 'device') : s.schedules;
  const reportedClock = s.device.deviceDate && s.device.deviceTime ? new Date(`${s.device.deviceDate}T${s.device.deviceTime}`) : null;
  const deviceNow = s.integration ? s.device.clockValid !== false && reportedClock && Number.isFinite(+reportedClock) ? reportedClock : null : now;
  const next = deviceNow && (!s.integration || s.device.online && s.device.rtcStatus === 'synced') ? nextSchedule(activeSchedules, deviceNow) : undefined;
  const alerts = s.alerts.filter(a => !a.acknowledged);
  const today = s.history.filter(h => dayKey(h.scheduledTime) === dayKey(now));
  const acknowledged = today.filter(h => h.result === 'Acknowledged').length;
  const missed = today.filter(h => h.result === 'Missed').length;
  const pending = today.filter(h => h.result === 'Pending');
  const firstPending = pending.at(-1);
  const total = Math.max(activeSchedules.filter(m => m.enabled).length, acknowledged + missed + pending.length);
  const sorted = [...activeSchedules].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  return <>
    <div className="page-heading"><div><div className="breadcrumb">WORKSPACE <ChevronRight size={12} /> OVERVIEW</div><h1>System overview<span className="heading-dot" /></h1><p>Real-time visibility. Every compartment, every reminder.</p></div><div className="heading-actions"><span className="live-label"><i />{s.device.online ? 'LIVE MONITORING' : 'DEVICE OFFLINE'}</span><a className="button primary" href="#schedules/new"><Plus size={16} />Add schedule</a></div></div>
    <div className="stats-grid">
      <section className="stat-card"><div className="stat-label"><span>DEVICE STATUS</span><Cpu size={17} /></div><div className="stat-value"><span className={`status-dot ${s.device.online ? 'online' : ''}`} /><strong>{s.device.online ? 'Online' : 'Offline'}</strong><Badge tone={s.device.online ? 'green' : 'muted'}>{s.device.online ? 'Connected' : 'Disconnected'}</Badge></div><div className="stat-meta mono">{s.device.ipAddress}<span>ESP32</span></div><div className="stat-bottom"><span>RTC <b className={s.device.rtcStatus === 'synced' ? 'text-green' : 'text-amber'}>{s.device.rtcStatus}</b></span><span>Last seen {seconds(s.device.lastSeen)}</span></div></section>
      <section className="stat-card next-stat"><div className="stat-label"><span>{firstPending ? 'REMINDER PENDING' : 'NEXT MEDICINE'}</span><Clock3 size={17} /></div><div className="stat-value"><strong className="medicine-stat">{firstPending?.medicineName || next?.schedule.medicineName || (s.integration && activeSchedules.length ? 'RTC unavailable' : 'No schedule')}</strong></div><div className="stat-meta">{firstPending ? `Compartment ${firstPending.requiredCompartment} · awaiting acknowledgment` : next ? `Compartment ${next.schedule.compartment} · ${time(next.at)}` : s.integration && activeSchedules.length ? 'Countdown requires a valid online device RTC' : 'Add an enabled medicine schedule'}</div><div className="stat-bottom"><span>{firstPending ? 'Push-button confirmation required' : 'Next reminder in'}</span>{next && !firstPending && deviceNow && <strong className="mono text-green">{countdown(next.at, deviceNow)}</strong>}</div></section>
      <section className="stat-card"><div className="stat-label"><span>TODAY’S MEDICINES</span><CalendarDays size={17} /></div><div className="stat-value"><strong>{acknowledged}<span className="stat-denominator"> / {total}</span></strong><span className="muted text-xs">acknowledged</span></div><div className="progress-track"><span style={{ width: `${total ? Math.min(100, acknowledged / total * 100) : 0}%` }} /></div><div className="stat-bottom"><span><i className="tiny-dot amber" />{Math.max(pending.length, total - acknowledged - missed)} pending</span><span><i className="tiny-dot red" />{missed} missed</span></div></section>
      <section className="stat-card"><div className="stat-label"><span>ACTIVE ALERTS</span><Bell size={17} /></div><div className="stat-value"><strong>{alerts.length.toString().padStart(2, '0')}</strong><Badge tone={alerts.some(a => a.severity === 'critical') ? 'red' : alerts.length ? 'amber' : 'green'}>{alerts.length ? 'Review alerts' : 'All clear'}</Badge></div><div className="stat-meta"><span>{alerts.filter(a => a.severity === 'critical').length} critical</span><span>{alerts.filter(a => a.severity === 'warning').length} warnings</span></div><div className="stat-bottom"><span>{alerts.filter(a => ['device-disconnected', 'reed-fault', 'servo-fault'].includes(a.type)).length} device problems</span><a href="#alerts">View alerts <ArrowUpRight size={13} /></a></div></section>
    </div>
    <div className="overview-main">
      <Panel title="Live medicine box" eyebrow="COMPARTMENT TELEMETRY" action={<Badge tone={s.device.online ? 'green' : 'muted'} dot>{s.device.online ? s.integration ? 'ESP32 reachable' : 'System operational' : 'Device offline'}</Badge>}><div className="compartment-grid">{s.compartments.map(c => <CompartmentCard key={c.compartment} compartment={c} schedules={s.schedules} online={s.device.online} />)}</div><div className="box-panel-footer"><span><Radio size={13} />{s.device.online ? `Feedback refreshes every ${s.settings.refreshInterval}s` : 'Telemetry frozen · last known values'}</span><a href="#control">Device controls <ArrowUpRight size={13} /></a></div></Panel>
      <Panel title="Live event log" eyebrow="SYSTEM ACTIVITY" action={<span className="live-label"><i />{s.device.online ? 'LIVE' : 'OFFLINE'}</span>} className="events-panel"><EventLog events={s.events} compact /><a className="panel-bottom-link" href="#monitoring">View all device events <ArrowUpRight size={14} /></a></Panel>
    </div>
    <div className="overview-bottom"><Panel title="Medicine schedule" action={<a className="text-link" href="#schedules">Manage schedules <ArrowUpRight size={14} /></a>}><div className="table-scroll"><table><thead><tr><th>Medicine</th><th>Compartment</th><th>Scheduled time</th><th>Status</th></tr></thead><tbody>{sorted.map(m => <tr key={m.id}><td className="table-primary"><span className="table-medicine-icon"><Plus size={13} /></span>{m.medicineName}</td><td><span className="compartment-tag">C{m.compartment}</span>Compartment {m.compartment}</td><td className="mono">{scheduleTime(m.scheduledTime)}</td><td><Badge tone={m.enabled ? 'green' : 'muted'} dot>{m.enabled ? 'Enabled' : 'Disabled'}</Badge></td></tr>)}</tbody></table>{!sorted.length && <Empty>No schedules. Add your first medicine reminder.</Empty>}</div><div className="table-note"><ShieldCheck size={13} /> Intake acknowledgment reflects device events and user confirmation.</div></Panel><Panel title="Acknowledgment activity" action={<span className="period-label">Last 7 days <ArrowDownLeft size={13} /></span>}><ActivityChart history={s.history} now={now} /></Panel></div>
    <DemoControls snapshot={s} /><RealDeviceControls snapshot={s} />
  </>;
}
