import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageExpiresAt } from '../lib/image-retention.ts';
import { POST as createSoul } from '../app/api/soul-character/route.ts';
import { POST as createMotion, GET as getMotion } from '../app/api/motion-control/route.ts';

test('three calendar months clamp end of month correctly', () => {
  assert.equal(new Date(imageExpiresAt(new Date('2026-01-31T12:00:00Z'))).toISOString(), '2026-04-30T12:00:00.000Z');
  assert.equal(new Date(imageExpiresAt(new Date('2026-11-30T12:00:00Z'))).toISOString(), '2027-02-28T12:00:00.000Z');
});
test('Soul requires 5–10 references and forwards the whole identity dataset', async () => {
  const originalFetch = globalThis.fetch;
  const key = process.env.HIGGSFIELD_API_KEY;
  process.env.HIGGSFIELD_API_KEY = 'test';
  const make = (count) => new Request('https://studio.example/api/soul-character', { method: 'POST', body: JSON.stringify({ name: 'Avatar', references: Array.from({length: count}, (_, i) => `https://studio.example/api/image/${i}`) }) });
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).input_images.length, 10);
      return Response.json({id: 'soul-id', status: 'queued'});
    };
    assert.equal((await createSoul(make(4))).status, 400);
    assert.equal((await createSoul(make(11))).status, 400);
    assert.equal((await createSoul(make(10))).status, 200);
  } finally { globalThis.fetch = originalFetch; if (key === undefined) delete process.env.HIGGSFIELD_API_KEY; else process.env.HIGGSFIELD_API_KEY = key; }
});
test('Motion Control validates inputs and exposes the finished video', async () => {
  const originalFetch = globalThis.fetch;
  const key = process.env.KLING_API_KEY;
  process.env.KLING_API_KEY = 'test';
  try {
    assert.equal((await createMotion(new Request('https://studio.example/api/motion-control', {method:'POST', body:'{}'}))).status, 400);
    globalThis.fetch = async () => Response.json({code:0, data:{task_status:'succeed',task_result:{videos:[{url:'https://example.com/video.mp4'}]}}});
    assert.deepEqual(await (await getMotion(new Request('https://studio.example/api/motion-control?taskId=test'))).json(), {status:'SUCCEEDED',url:'https://example.com/video.mp4'});
    globalThis.fetch = async () => Response.json({code:0, data:{task_status:'failed',task_status_msg:'Invalid reference'}});
    assert.equal((await (await getMotion(new Request('https://studio.example/api/motion-control?taskId=test'))).json()).status, 'FAILED');
  } finally { globalThis.fetch = originalFetch; if (key === undefined) delete process.env.KLING_API_KEY; else process.env.KLING_API_KEY = key; }
});
