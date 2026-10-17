import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiGateway } from './apiGateway';
import { createSeed } from '../data/seed';

describe('backend gateway', () => {
  let gateway: ApiGateway;
  let fetcher: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers(); fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    gateway = new ApiGateway('http://localhost:3000/api');
  });
  afterEach(() => { gateway.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  it('loads and publishes runtime-validated snapshots', async () => {
    const listener = vi.fn(); gateway.subscribe(listener);
    fetcher.mockResolvedValue(response(createSeed()));
    await gateway.connect(); expect(gateway.getSnapshot()?.device.online).toBe(true); expect(listener).toHaveBeenCalledOnce();
  });
  it('rejects malformed payloads and non-success responses', async () => {
    fetcher.mockResolvedValueOnce(response({ bogus: true })); await expect(gateway.connect()).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 })); await expect(gateway.connect()).rejects.toThrow('503');
    expect(gateway.getSnapshot()).toBeNull();
  });
  it('preserves last known values on failure and recovers when backend returns', async () => {
    fetcher.mockResolvedValueOnce(response(createSeed())); await gateway.connect();
    fetcher.mockRejectedValueOnce(new Error('Network error'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(gateway.getSnapshot()?.device.online).toBe(false);
    expect(gateway.getSnapshot()?.storageWarning).toContain('Backend unavailable');
    expect(gateway.getSnapshot()?.schedules).toHaveLength(2);
    fetcher.mockResolvedValueOnce(response(createSeed())); await vi.advanceTimersByTimeAsync(1000);
    expect(gateway.getSnapshot()?.device.online).toBe(true); expect(gateway.getSnapshot()?.storageWarning).toBeNull();
  });
  it('posts commands and then refreshes authoritative device state', async () => {
    fetcher.mockResolvedValueOnce(response(createSeed())); await gateway.connect();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response(createSeed()));
    await gateway.command({ type: 'test-speaker' });
    expect(fetcher).toHaveBeenNthCalledWith(2, 'http://localhost:3000/api/commands', expect.objectContaining({ method: 'POST', body: '{"type":"test-speaker"}' }));
    expect(fetcher).toHaveBeenNthCalledWith(3, 'http://localhost:3000/api/snapshot', expect.objectContaining({ method: 'GET' }));
  });
  it('handles React StrictMode disconnect/reconnect during an in-flight initial fetch', async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; })).mockResolvedValueOnce(response(createSeed()));
    const first = gateway.connect(); gateway.disconnect(); const second = gateway.connect();
    resolve(response(createSeed())); await Promise.all([first, second]);
    expect(gateway.getSnapshot()?.device.online).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
