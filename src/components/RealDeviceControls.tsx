import { Check, Zap } from 'lucide-react';
import type { Snapshot } from '../types';
import { gateway } from '../services';
import { deviceService } from '../services/deviceService';
import { useAction } from '../hooks/useAction';
import { Badge, Feedback, Panel } from './ui';

export function RealDeviceControls({ snapshot: s }: { snapshot: Snapshot }) {
  const { run, busy, feedback } = useAction();
  if (gateway.mode !== 'live') return null;
  const compatible = s.integration?.firmwareProfile === 'kkk';
  const due = s.compartments.some(c => c.medicineStatus === 'DUE');
  return <Panel title="ESP32 medicine cycle" action={<Badge tone="blue">REAL DEVICE</Badge>}>
    <div className="toolbar wrap">
      <div className="flex items-center gap-2 flex-wrap">
        {([1, 2] as const).map(compartment => <button key={compartment} className="button" disabled={busy || !s.device.online || !compatible} onClick={() => run(() => deviceService.command({ type: 'test-medicine', compartment }), `Success: ESP32 confirmed Medicine ${compartment} test.`)}><Zap size={15} />Test medicine {compartment}</button>)}
        <button className="button subtle-green" disabled={busy || !s.device.online || !compatible || !due} onClick={() => run(() => deviceService.command({ type: 'acknowledge-medicine' }), 'Medicine intake acknowledged')}><Check size={15} />Acknowledge active medicine</button>
      </div>
      <Badge tone={s.device.alarm === true ? 'amber' : s.device.alarm === false ? 'green' : 'muted'}>Alarm {s.device.alarm === true ? 'ACTIVE' : s.device.alarm === false ? 'IDLE' : 'UNKNOWN'}</Badge>
    </div>
    <div className="table-note">Tests start the firmware’s complete medicine cycle. Direct servo, LED-only and speaker-only commands are unavailable. {compatible ? 'Acknowledgment records device confirmation, not ingestion.' : 'Waiting for the confirmed kkk.ino status schema; controls remain unavailable.'}</div>
    {feedback && <div className="diagnostics"><Feedback value={feedback} /></div>}
  </Panel>;
}
