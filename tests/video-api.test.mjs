import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../app/api/generate-video/route.ts', import.meta.url), 'utf8')
  .replace("import { env } from 'cloudflare:workers';", 'const env = { IMAGE_CACHE: { put: async () => {} } };');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { POST, GET } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('video API validates requests and uses A2E for image-to-video', async () => {
  const originalFetch = globalThis.fetch;
  const originalKling = process.env.KLING_API_KEY;
  const originalA2E = process.env.A2E_API_TOKEN;
  process.env.KLING_API_KEY = 'kling-test';
  process.env.A2E_API_TOKEN = 'a2e-test';
  const request = (body, url = 'https://studio.example/api/generate-video') => new Request(url, { method: 'POST', body: JSON.stringify(body) });
  try {
    globalThis.fetch = async () => { throw new Error('Invalid input must not call provider'); };
    assert.equal((await POST(request({ prompt: 'ab' }))).status, 400);
    for (const duration of [8, 13, 15, -1]) assert.equal((await POST(request({ prompt: 'Coffee scene', duration }))).status, 400);
    assert.equal((await POST(request({ prompt: 'Coffee scene', provider: 'a2e', duration: 12, mode: 'image', referenceImage: 'data:image/png;base64,dGVzdA==' }))).status, 400);
    assert.equal((await POST(request({ prompt: 'Coffee scene', aspectRatio: 'invalid' }))).status, 400);
    assert.equal((await GET(new Request('https://studio.example/api/generate-video?taskId=../secret'))).status, 400);

    globalThis.fetch = async (_url, options) => {
      assert.equal(String(_url), 'https://api.klingai.com/v1/videos/text2video');
      const body = JSON.parse(options.body);
      assert.equal(body.duration, '10');
      assert.equal(body.aspect_ratio, '16:9');
      return Response.json({ data: { task_id: 'test-task' } });
    };
    assert.deepEqual(await (await POST(request({ prompt: 'Coffee scene', duration: 10, aspectRatio: '16:9' }))).json(), { taskId: 'kling:text:test-task' });

    globalThis.fetch = async (_url, options) => {
      assert.equal(String(_url), 'https://api.klingai.com/v1/videos/image2video');
      const body = JSON.parse(options.body);
      assert.ok(body.image.startsWith('https://studio.example/api/image/'));
      assert.equal(body.image_url, undefined);
      return Response.json({ data: { task_id: 'image-kling-task' } });
    };
    assert.deepEqual(await (await POST(request({ prompt: 'Walk forward', duration: 5, mode: 'image', referenceImage: 'data:image/png;base64,dGVzdA==' }))).json(), { taskId: 'kling:image:image-kling-task' });

    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://video.a2e.ai/api/v1/userWanSpicy/start');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'wan2.7-i2v-spicy');
      assert.equal(body.resolution, '720p');
      assert.equal(body.duration, 10);
      assert.ok(body.image_url.startsWith('https://studio.example/api/image/'));
      return Response.json({ data: { _id: 'image-task' } });
    };
    assert.deepEqual(await (await POST(request({ prompt: 'Animate the scene', provider: 'a2e', mode: 'image', duration: 10, referenceImage: 'data:image/png;base64,dGVzdA==' }))).json(), { taskId: 'a2e:image-task' });

    for (const status of ['sent', 'pending', 'failed', 'completed']) {
      globalThis.fetch = async () => Response.json({ data: { current_status: status, result_url: 'https://example.com/video.mp4' } });
      const response = await GET(new Request('https://studio.example/api/generate-video?taskId=a2e:image-task'));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      if (status === 'completed') assert.equal(result.url, 'https://example.com/video.mp4');
      if (status === 'failed') assert.equal(result.status, 'FAILED');
      if (status === 'sent' || status === 'pending') assert.equal(result.status, 'RUNNING');
    }

    globalThis.fetch = async () => Response.json({ data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://example.com/video.mp4' }] } } });
    const response = await GET(new Request('https://studio.example/api/generate-video?taskId=kling:text:test-task'));
    assert.equal((await response.json()).url, 'https://example.com/video.mp4');

    delete process.env.KLING_API_KEY;
    delete process.env.A2E_API_TOKEN;
    assert.equal((await POST(request({ prompt: 'Coffee scene' }))).status, 501);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKling === undefined) delete process.env.KLING_API_KEY; else process.env.KLING_API_KEY = originalKling;
    if (originalA2E === undefined) delete process.env.A2E_API_TOKEN; else process.env.A2E_API_TOKEN = originalA2E;
  }
});
