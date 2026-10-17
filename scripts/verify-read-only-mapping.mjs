import assert from 'node:assert/strict';

const sourceUrl = process.env.ESP32_URL;
assert.ok(sourceUrl, 'ESP32_URL must be configured');
const backendUrl = `http://127.0.0.1:${process.env.BACKEND_PORT || 3000}`;
const read = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); return response.json();
};
let matched = false;
for (let attempt = 1; attempt <= 8; attempt++) {
  try {
    const [source, status, snapshot] = await Promise.all([read(`${sourceUrl}/api/status`), read(`${backendUrl}/api/status`), read(`${backendUrl}/api/snapshot`)]);
    assert.equal(snapshot.device.deviceTime, snapshot.firmwareStatus.time);
    assert.equal(snapshot.device.deviceDate, snapshot.firmwareStatus.date);
    assert.equal(snapshot.device.rtcStatus, 'synced');
    assert.equal(status.rtc, 'ACTIVE'); assert.equal(status.rtcStatus, 'synced');
    for (const slot of [1, 2]) {
      assert.equal(status[`compartment${slot}`].reed, status[`med${slot}`].reed);
      assert.equal(status[`compartment${slot}`].door, status[`med${slot}`].compartment.toLowerCase());
      assert.equal(status[`compartment${slot}`].servo, 'unknown');
      assert.equal(status[`compartment${slot}`].led, null);
    }
    // Adjacent samples can differ by a tick. Retry until comparing the same raw clock strings.
    if (!status.online || source.time !== status.time || source.date !== status.date) continue;
    const rawKeys = ['time', 'date', 'rtc', 'wifi', 'ip', 'med1', 'med2', 'alarm', 'lastEvent'];
    assert.deepEqual(Object.fromEntries(rawKeys.map(key => [key, status[key]])), source);
    console.log(JSON.stringify({ upstreamUrl: `${sourceUrl}/api/status`, backendUrl: `${backendUrl}/api/status`, attempt, online: status.online, time: status.time, date: status.date, rtc: status.rtc, rtcStatus: status.rtcStatus, exactUpstreamPacketMatch: true, snapshotTimeDatePreserved: true, compartment1: status.compartment1, compartment2: status.compartment2, hardwareWrites: 0 }, null, 2));
    matched = true; break;
  } catch (error) {
    if (attempt === 8) throw error;
  }
}
assert.ok(matched, 'No matching live clock sample was obtained; cached mapping validation alone does not prove a fresh upstream match.');
