import type { DeviceEvent } from '../types';
import { seconds } from '../utils/time';
import { Empty } from './ui';
export function EventLog({ events, compact = false }: { events: DeviceEvent[]; compact?: boolean }) {
  return <div className={`event-log ${compact ? 'compact' : ''}`} aria-label="Device event log">{!events.length && <Empty>No device events yet.</Empty>}{events.slice(0, compact ? 7 : 100).map(event => <div className={`event event-${event.level}`} key={event.id}><span className="event-dot" /><time className="mono" dateTime={event.timestamp}>{seconds(event.timestamp)}</time><p>{event.message}</p></div>)}</div>;
}
