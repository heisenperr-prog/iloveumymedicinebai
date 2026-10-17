import { useState } from 'react';
import { Search } from 'lucide-react';
import type { HistoryResult, Snapshot } from '../types';
import { Panel } from '../components/ui';
import { HistoryTable } from '../components/HistoryTable';
import { historyService } from '../services/historyService';
export function History({ snapshot: s }: { snapshot: Snapshot }) {
  const [query, setQuery] = useState(''); const [result, setResult] = useState<HistoryResult | 'all'>('all'); const [day, setDay] = useState('');
  const records = historyService.filter(s.history, query, result, day);
  return <><div className="page-heading"><div><div className="breadcrumb">ACKNOWLEDGMENT RECORDS</div><h1>Medicine history</h1><p>Trace reminder events, compartment access, and user acknowledgments.</p></div></div><Panel title="Intake acknowledgment history" action={<span className="muted text-xs">{records.length} records</span>}><div className="toolbar wrap"><label className="search-field"><Search size={16} /><input aria-label="Search medicine history" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search medicine…" /></label><div className="flex items-center gap-2 flex-wrap"><input aria-label="Filter history by date" type="date" value={day} onChange={e => setDay(e.target.value)} /><select aria-label="Filter history by result" value={result} onChange={e => setResult(e.target.value as HistoryResult | 'all')}><option value="all">All results</option>{['Acknowledged', 'Wrong compartment', 'Missed', 'Pending', 'Manual override', 'Unconfirmed'].map(r => <option key={r}>{r}</option>)}</select><button className="button" onClick={() => { setQuery(''); setResult('all'); setDay(''); }}>Clear filters</button></div></div><HistoryTable history={records} /><div className="table-note">Acknowledgments indicate physical device events and user confirmation. The system cannot determine whether medicine was swallowed.</div></Panel></>;
}
