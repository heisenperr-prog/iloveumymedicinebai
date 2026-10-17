import { Beaker, Check, DoorOpen, Radio, TriangleAlert, Wifi, WifiOff, Zap } from 'lucide-react';
import type { Snapshot } from '../types';
import { deviceService } from '../services/deviceService';
import { useAction } from '../hooks/useAction';
import { Feedback } from './ui';
import { useState } from 'react';
import { gateway } from '../services';

export function DemoControls({ snapshot: s }: { snapshot: Snapshot }) {
  const { run, busy, feedback } = useAction();
  const [selected, setSelected] = useState('');
  const enabled = s.schedules.filter(m => m.enabled);
  const scheduleId = enabled.some(m => m.id === selected) ? selected : enabled[0]?.id;
  if (gateway.mode !== 'demo') return null;
  return <section className="demo-controls"><div className="demo-heading"><span><Beaker size={16} /> DEMO EVENT SIMULATOR</span><small>Local simulation · no physical device connection</small></div><div className="demo-buttons">
    <select aria-label="Medicine for simulated reminder" value={scheduleId || ''} onChange={e => setSelected(e.target.value)} disabled={!enabled.length}>{!enabled.length && <option value="">No enabled schedules</option>}{enabled.map(m => <option key={m.id} value={m.id}>{m.medicineName} · C{m.compartment}</option>)}</select>
    <button className="button" disabled={busy || !s.device.online || !scheduleId} onClick={() => run(() => deviceService.simulate({ type: 'trigger', scheduleId: scheduleId! }), 'Medicine reminder triggered.')}><Zap size={14} />Trigger schedule</button>
    {([1, 2] as const).map(compartment => <button className="button" key={compartment} disabled={busy || !s.device.online} onClick={() => run(() => deviceService.simulate({ type: 'open', compartment }), `Compartment ${compartment} opened.`)}><DoorOpen size={14} />Open C{compartment}</button>)}
    <button className="button" disabled={busy || !s.device.online} onClick={() => run(() => deviceService.simulate({ type: 'wrong-compartment' }), 'Wrong compartment event simulated.')}><TriangleAlert size={14} />Wrong compartment</button>
    <button className="button" disabled={busy} onClick={() => run(() => deviceService.simulate({ type: 'connection', online: !s.device.online }), s.device.online ? 'Demo ESP32 disconnected.' : 'Demo ESP32 reconnected.')} >{s.device.online ? <WifiOff size={14} /> : <Wifi size={14} />}{s.device.online ? 'Go offline' : 'Reconnect'}</button>
    <button className="button subtle-green" disabled={busy || !s.device.online} onClick={() => run(() => deviceService.simulate({ type: 'acknowledge' }), 'Medicine intake acknowledged.')}><Check size={14} />Acknowledge intake</button>
  </div><Feedback value={feedback} /><p className="demo-hint"><Radio size={12} /> Trigger a reminder, open its required compartment, then simulate the push-button acknowledgment.</p></section>;
}
