/** Test-only example supplied by the user; never imported by the running backend. */
export function firmwareStatus(status: 'WAITING' | 'DUE' | 'TAKEN' = 'WAITING') {
  return { time: '13:45:22', date: '2026-10-08', rtc: 'ACTIVE', wifi: 'CONNECTED', ip: '10.216.159.229',
    med1: { name: 'Medicine 1', hour: 11, minute: 8, schedule: '11:08', status, compartment: 'CLOSED', reed: false },
    med2: { name: 'Medicine 2', hour: 11, minute: 20, schedule: '11:20', status: 'WAITING', compartment: 'CLOSED', reed: false }, alarm: status === 'DUE', lastEvent: 'System started' };
}
