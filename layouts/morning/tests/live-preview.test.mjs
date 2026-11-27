import assert from 'node:assert/strict';
import { test } from 'node:test';
import { livePreview } from '../src/lib/live-preview.ts';

test('live data requires browser authentication before any backend request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const result = await livePreview(null, 'morning');
  assert.equal(result.status, 401);
  assert.match(result.headers.get('www-authenticate'), /realm="Art Frames"/);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(fetch.mock.calls.length, 0);
});

test('only the fixed local backend receives authorization; no redirects', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8765/screen/preview-data');
    assert.equal(options.headers.Authorization, 'Basic dGVzdDp0ZXN0');
    assert.equal(options.redirect, 'error');
    return Response.json({ now:'2030-01-02T08:00:00Z', data:{headline:'Real backend data'} });
  });
  const result = await livePreview('Basic dGVzdDp0ZXN0', 'art');
  assert.equal(result.data.headline, 'Real backend data');
});

test('backend authentication errors preserve challenge and failures never substitute samples', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private details',{status:401}));
  assert.equal((await livePreview('Basic dGVzdDp0ZXN0','morning')).status,401);
  fetch.mock.mockImplementation(async () => { throw new Error('private-calendar-token'); });
  const result=await livePreview('Basic dGVzdDp0ZXN0','morning');
  assert.equal(result.status,503);
  assert.doesNotMatch(await result.text(),/private-calendar-token/);
});
