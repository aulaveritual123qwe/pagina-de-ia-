import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST, GET } from '../app/api/generate-video/route.ts';

test('video API validates requests and handles asynchronous provider outcomes', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.QWEN_API_KEY;
  process.env.QWEN_API_KEY = 'test-only';
  const request = (body) => new Request('http://localhost/api/generate-video', { method: 'POST', body: JSON.stringify(body) });
  try {
    globalThis.fetch = async () => { throw new Error('Invalid input must not call provider'); };
    assert.equal((await POST(request({ prompt: 'ab' }))).status, 400);
    assert.equal((await POST(request({ prompt: 'Coffee scene', duration: 8 }))).status, 400);
    assert.equal((await POST(request({ prompt: 'Coffee scene', aspectRatio: 'invalid' }))).status, 400);
    assert.equal((await GET(new Request('http://localhost/api/generate-video?taskId=../secret'))).status, 400);
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.parameters.duration, 10);
      assert.equal(body.parameters.ratio, '16:9');
      return Response.json({ output: { task_id: 'test-task' } });
    };
    assert.deepEqual(await (await POST(request({ prompt: 'Coffee scene', duration: 10, aspectRatio: '16:9' }))).json(), { taskId: 'test-task' });
    for (const status of ['PENDING', 'RUNNING', 'FAILED', 'CANCELED', 'UNKNOWN', 'SUCCEEDED']) {
      globalThis.fetch = async () => Response.json({ output: { task_status: status, video_url: 'https://example.com/video.mp4' } });
      const response = await GET(new Request('http://localhost/api/generate-video?taskId=test-task'));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.status, ['CANCELED', 'UNKNOWN'].includes(status) ? 'FAILED' : status);
      if (status === 'SUCCEEDED') assert.equal(result.url, 'https://example.com/video.mp4');
    }
    globalThis.fetch = async () => Response.json({ output: { task_status: 'SUCCEEDED' } });
    assert.equal((await GET(new Request('http://localhost/api/generate-video?taskId=test-task'))).status, 502);
    globalThis.fetch = async () => Response.json({}, { status: 503 });
    assert.equal((await POST(request({ prompt: 'Coffee scene' }))).status, 502);
    delete process.env.QWEN_API_KEY;
    assert.equal((await POST(request({ prompt: 'Coffee scene' }))).status, 501);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = originalKey;
  }
});
