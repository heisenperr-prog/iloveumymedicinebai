import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { RealDeviceController } from './controller.ts';
import { DeviceApiError, Esp32Service } from './esp32Service.ts';
import type { DeviceCommand } from '../src/types/index.ts';

const compartment = z.union([z.literal(1), z.literal(2)]);
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set-door'), compartment, open: z.boolean() }),
  z.object({ type: z.literal('test-led'), compartment }),
  z.object({ type: z.literal('test-speaker') }), z.object({ type: z.literal('sync-rtc') }),
  z.object({ type: z.literal('test-medicine'), compartment }), z.object({ type: z.literal('acknowledge-medicine') }),
]);

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > 32768) throw new DeviceApiError('Request body exceeds 32 KiB.', 413);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DeviceApiError('A valid JSON request body is required.', 400); }
}

export function createApiServer(controller: RealDeviceController, origins = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173']) {
  return createServer((request, response) => { void handle(request, response); });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.headers.origin) {
        if (!origins.includes(request.headers.origin)) throw new DeviceApiError('Origin is not allowed.', 403);
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      const method = request.method;
      if (path === '/api/health' && method === 'GET') return send(200, { backend: 'online', deviceOnline: controller.snapshot.device.online });
      if (path === '/api/snapshot' && method === 'GET') return send(200, controller.snapshot);
      if (path === '/api/status' && method === 'GET') {
        const s = controller.snapshot;
        const sensorStatus = (slot: 1 | 2) => {
          const c = s.compartments.find(item => item.compartment === slot)!;
          return { door: c.doorStatus, doorSource: c.doorSource, reed: c.reed ?? (c.reedSwitch === 'unknown' ? null : c.reedSwitch === 'detected'), servo: c.servoStatus, led: c.ledStatus };
        };
        return send(200, { ...s.firmwareStatus, online: s.device.online, device: s.settings.deviceName, ip: s.device.ipAddress, rtc: s.device.rtcReported ?? s.device.rtcStatus, rtcStatus: s.device.rtcStatus, clockValid: s.device.clockValid ?? false, time: s.device.deviceTime, date: s.device.deviceDate, alarm: s.device.alarm ?? null, lastEvent: s.device.lastEvent ?? null, compartment1: sensorStatus(1), compartment2: sensorStatus(2), acknowledgment: s.device.acknowledgment ?? null, lastSeen: s.device.lastSeen, timestamp: s.device.lastSeen, integration: s.integration });
      }
      const door = /^\/api\/compartment\/([12])\/(open|close)$/.exec(path);
      const led = /^\/api\/test\/led\/([12])$/.exec(path);
      let command: DeviceCommand | undefined;
      if (door && method === 'POST') command = { type: 'set-door', compartment: Number(door[1]) as 1 | 2, open: door[2] === 'open' };
      if (led && method === 'POST') command = { type: 'test-led', compartment: Number(led[1]) as 1 | 2 };
      if (path === '/api/test/speaker' && method === 'POST') command = { type: 'test-speaker' };
      const medicineTest = /^\/api\/medicine\/([12])\/test$/.exec(path);
      if (medicineTest && method === 'POST') command = { type: 'test-medicine', compartment: Number(medicineTest[1]) as 1 | 2 };
      if (path === '/api/medicine/ack' && method === 'POST') command = { type: 'acknowledge-medicine' };
      if (path === '/api/commands' && method === 'POST') command = commandSchema.parse(await jsonBody(request));
      if (command) return send(200, await controller.command(command));
      if (path === '/api/schedules' && method === 'POST') { await controller.saveSchedule(await jsonBody(request)); return send(200, { success: true }); }
      const schedule = /^\/api\/schedules\/([^/]+)$/.exec(path);
      if (schedule && method === 'PUT') { await controller.saveSchedule(await jsonBody(request), decodeURIComponent(schedule[1])); return send(200, { success: true }); }
      if (schedule && method === 'DELETE') { await controller.deleteSchedule(decodeURIComponent(schedule[1])); return send(200, { success: true }); }
      const alert = /^\/api\/alerts\/([^/]+)\/acknowledge$/.exec(path);
      if (alert && method === 'POST') { controller.acknowledgeAlert(decodeURIComponent(alert[1])); return send(200, { success: true }); }
      if (path === '/api/settings' && method === 'PUT') { await controller.saveSettings(await jsonBody(request)); return send(200, { success: true }); }
      return send(404, { success: false, error: 'API endpoint not found.' });
    } catch (error) {
      send(error instanceof DeviceApiError ? error.status : error instanceof z.ZodError ? 400 : 500, { success: false, error: error instanceof Error ? error.message : 'Backend request failed.' });
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const deviceUrl = process.env.ESP32_URL;
  if (!deviceUrl) throw new Error('Set ESP32_URL in .env.local before starting the real-device backend.');
  const port = Number(process.env.BACKEND_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('BACKEND_PORT must be between 1024 and 65535.');
  const service = new Esp32Service(deviceUrl, Number(process.env.ESP32_TIMEOUT_MS || 1800));
  const controller = new RealDeviceController(service, resolve('.data/real-device.json'));
  await controller.initialize();
  const server = createApiServer(controller);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Real-device backend: http://127.0.0.1:${port}`);
    console.log(`ESP32 target: ${service.baseUrl}; polling every 1–2 seconds. Unreported telemetry stays unknown.`);
    controller.start();
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  const stop = () => { server.close(); void controller.stop().then(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
