import { DoorClosed, DoorOpen, Lightbulb, Radio, Settings2, Pill, CircleCheck } from 'lucide-react';
import { Badge } from './ui';
import type { CompartmentStatus, MedicineSchedule } from '../types';
import { scheduleTime } from '../utils/time';

export function CompartmentCard({ compartment: c, schedules, online }: { compartment: CompartmentStatus; schedules: MedicineSchedule[]; online: boolean }) {
  const fault = c.reedSwitch === 'fault' || c.servoStatus === 'fault';
  const tone = !online || c.doorStatus === 'unknown' ? 'muted' : fault ? 'red' : c.doorStatus === 'open' ? 'amber' : 'green';
  const items = schedules.filter(s => s.compartment === c.compartment && s.enabled && s.syncStatus !== 'draft').sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  return <article className={`compartment compartment-${tone}`}>
    <div className="compartment-top"><span className="eyebrow">COMPARTMENT 0{c.compartment}</span><Badge tone={tone} dot>{!online ? 'OFFLINE' : fault ? 'FAULT' : c.doorStatus.toUpperCase()}</Badge></div>
    <div className="box-visual"><div className={`box-door ${c.doorStatus === 'open' ? 'door-open' : ''}`}><span className="box-number">0{c.compartment}</span><Pill size={37} strokeWidth={1.3} /><div className="box-handle" /><span className={`box-led ${c.ledStatus && online ? 'lit' : ''}`} /></div><div className="box-caption"><span /><span>{!online ? 'SIGNAL UNAVAILABLE' : c.doorStatus === 'open' ? 'ACCESS OPEN' : c.doorStatus === 'unknown' ? 'STATE UNAVAILABLE' : 'SECURE & READY'}</span><span /></div></div>
    <div className="medicine-label"><span className="medicine-icon"><Pill size={17} /></span><div><h3>{c.currentMedicine}</h3>{c.medicineStatus && <Badge tone={c.medicineStatus === "DUE" ? "amber" : c.medicineStatus === "TAKEN" ? "green" : "muted"}>{c.medicineStatus === "TAKEN" ? "ACKNOWLEDGED (TAKEN)" : c.medicineStatus}</Badge>}<p>{items.length ? items.map(s => scheduleTime(s.scheduledTime)).join(' · ') : 'No enabled schedule'}</p></div></div>
    <div className="sensor-grid">
      <div>{c.doorStatus === 'open' ? <DoorOpen size={15} /> : <DoorClosed size={15} />}<span>Door</span><strong className={online && c.doorStatus === 'open' ? 'text-amber' : ''}>{online ? c.doorStatus : 'unknown'}</strong></div>
      <div><Radio size={15} /><span>Reed switch</span><strong className={c.reedSwitch === 'fault' ? 'text-red' : online && c.reedSwitch === 'detected' ? 'text-green' : ''}>{!online ? 'UNKNOWN' : c.reed == null ? c.reedSwitch.replace('-', ' ').toUpperCase() : c.reed ? 'OPEN (true)' : 'CLOSED (false)'}</strong></div>
      <div><Settings2 size={15} /><span>{c.doorSource ? 'Servo command' : 'Servo'}</span><strong className={c.servoStatus === 'fault' ? 'text-red' : ''}>{online ? c.servoStatus : 'unknown'}</strong></div>
      <div><Lightbulb size={15} /><span>LED</span><strong className={online && c.ledStatus ? 'text-amber' : ''}>{online ? c.ledStatus === null ? 'unknown' : c.ledStatus ? 'on' : 'off' : 'unknown'}</strong></div>
    </div>
    <div className="compartment-footer"><CircleCheck size={13} /><span>{!online ? 'Showing last known states' : fault ? 'Device fault requires attention' : c.doorSource === 'unavailable' ? 'No door/sensor feedback reported' : c.doorSource === 'reed' ? 'Door derived from reed; servo position unmeasured' : 'Sensor feedback synchronized'}</span></div>
  </article>;
}
