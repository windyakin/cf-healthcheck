// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { getColor, getEmoji, Health } from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('fetch', () => {
  it('responds test (unit style)', async () => {
    await env.STATUS_KV.put('endpoint-status--httpbin-org', Health.OK);
    const request = new IncomingRequest('http://example.com');
    // Create an empty context to pass to `worker.fetch()`.
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toMatchInlineSnapshot(`"httpbin.org is healthy"`);
  });

  it('responds with healthy status', async () => {
    await env.STATUS_KV.put('endpoint-status--httpbin-org', Health.OK);
    const response = await SELF.fetch('https://example.com');
    expect(await response.text()).toMatchInlineSnapshot(`"httpbin.org is healthy"`);
  });

  it('responds with unhealthy status', async () => {
    await env.STATUS_KV.put('endpoint-status--httpbin-org', Health.ERROR);
    const response = await SELF.fetch('https://example.com');
    expect(await response.text()).toMatchInlineSnapshot(`"httpbin.org is unhealthy"`);
  });

  it('responds with dead status', async () => {
    await env.STATUS_KV.put('endpoint-status--httpbin-org', Health.FAILED);
    const response = await SELF.fetch('https://example.com');
    expect(await response.text()).toMatchInlineSnapshot(`"httpbin.org is dead"`);
  });

  it('responds with unknown status', async () => {
    await env.STATUS_KV.put('endpoint-status--httpbin-org', null);
    const response = await SELF.fetch('https://example.com');
    expect(await response.text()).toMatchInlineSnapshot(`"httpbin.org is null"`);
  });
});

describe('getColor', () => {
  it('returns correct color for Health.OK', () => {
    expect(getColor(Health.OK)).toBe('#008888');
  });

  it('returns correct color for Health.FAILED', () => {
    expect(getColor(Health.ERROR)).toBe('#FF8800');
  });

  it('returns correct color for Health.DEAD', () => {
    expect(getColor(Health.FAILED)).toBe('#880000');
  });

  it('returns gray for unknown status', () => {
    expect(getColor(null)).toBe('gray');
  });
});

describe('getEmoji', () => {
  it('returns correct emoji for Health.OK', () => {
    expect(getEmoji(Health.OK)).toBe(':white_check_mark:');
  });

  it('returns correct emoji for Health.FAILED', () => {
    expect(getEmoji(Health.ERROR)).toBe(':warning:');
  });

  it('returns correct emoji for Health.DEAD', () => {
    expect(getEmoji(Health.FAILED)).toBe(':x:');
  });

  it('returns question for unknown status', () => {
    expect(getEmoji(null)).toBe(':question:');
  });
});
