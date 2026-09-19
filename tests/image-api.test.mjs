import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

globalThis.__storedImageJob = null;
const source = fs.readFileSync(new URL('../app/api/generate-image/route.ts', import.meta.url), 'utf8')
  .replace("import { env } from 'cloudflare:workers';", 'const env = { IMAGE_CACHE: { put: async (key, value) => { if (key.startsWith("job:")) globalThis.__storedImageJob = JSON.parse(value); }, get: async () => globalThis.__storedImageJob } };')
  .replace("import { imageExpiresAt } from '@/lib/image-retention';", 'const imageExpiresAt = () => Date.now() + 86400000;');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { POST, GET } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('image generation uses A2E jobs and hides service errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalA2E = process.env.A2E_API_TOKEN;
  const originalQwen = process.env.QWEN_API_KEY;
  process.env.A2E_API_TOKEN = 'test-only';
  delete process.env.QWEN_API_KEY;
  const request = (body) => new Request('https://studio.example/api/generate-image', { method: 'POST', body: JSON.stringify(body) });
  try {
    const posted = [];
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'POST') {
        posted.push({ url: String(url), body: JSON.parse(options.body) });
        return Response.json({ data: { _id: `task-${posted.length}` } });
      }
      if (String(url).includes('/api/v1/userQwen2Image/detail/')) {
        return Response.json({ data: { current_status: 'completed', image_urls: ['https://example.com/1.png'] } });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    };

    const created = await POST(request({ prompt: 'Create a portrait', model: 'qwen', count: 1 }));
    assert.equal(created.status, 200);
    assert.match((await created.json()).jobId, /^[a-f0-9-]+$/i);
    assert.equal(posted[0].url, 'https://video.a2e.ai/api/v1/userQwen2Image/start');
    assert.equal(posted[0].body.model, 'qwen-image-2.0-pro');
    assert.equal(posted[0].body.size, '1024*1024');

    const completed = await GET(new Request('https://studio.example/api/generate-image?jobId=test'));
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).images.length, 1);

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.input_images[0].startsWith('https://studio.example/api/image/'));
      assert.equal(body.model, 'qwen-image-2.0-pro');
      assert.ok(body.input_images[0].startsWith('https://studio.example/api/image/'));
      return Response.json({ data: { _id: 'qwen-task' } });
    };
    const nano = await POST(request({ prompt: 'Change the background', model: 'qwen', referenceImage: 'data:image/png;base64,dGVzdA==', count: 1 }));
    assert.equal(nano.status, 200);

    globalThis.fetch = async () => Response.json({ message: 'Qwen internal error; reference = test' }, { status: 500 });
    const failed = await POST(request({ prompt: 'Create a portrait', model: 'qwen', count: 1 }));
    assert.equal(failed.status, 500);
    assert.doesNotMatch((await failed.json()).error, /Qwen|reference =/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalA2E === undefined) delete process.env.A2E_API_TOKEN; else process.env.A2E_API_TOKEN = originalA2E;
    if (originalQwen === undefined) delete process.env.QWEN_API_KEY; else process.env.QWEN_API_KEY = originalQwen;
  }
});

test('Seedream uses saved avatar references and one optional reference', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAGNIFIC_API_KEY;
  process.env.MAGNIFIC_API_KEY = 'test-only';
  const request = (body) => new Request('https://studio.example/api/generate-image', { method: 'POST', body: JSON.stringify(body) });
  try {
    let submitted;
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'POST') {
        submitted = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
        return Response.json({ data: { task_id: 'seedream-task', status: 'IN_PROGRESS' } });
      }
      if (String(url).endsWith('/seedream-task')) {
        return Response.json({ data: { task_id: 'seedream-task', status: 'COMPLETED', generated: ['https://example.com/avatar.png'] } });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    };
    const created = await POST(request({
      prompt: 'Retrato editorial con luz cálida', model: 'magnific', count: 4,
      avatarReferences: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg', 'https://example.com/4.jpg', 'https://example.com/5.jpg'],
      referenceImage: 'data:image/png;base64,dGVzdA==',
    }));
    assert.equal(created.status, 200);
    assert.equal(submitted.url, 'https://api.magnific.com/v1/ai/text-to-image/seedream-v4-5-edit');
    assert.equal(submitted.headers['x-magnific-api-key'], 'test-only');
    assert.equal(submitted.body.reference_images.length, 5);
    assert.deepEqual(submitted.body.reference_images.slice(0, 4), ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg', 'https://example.com/4.jpg']);
    assert.equal(submitted.body.reference_images[4], 'data:image/png;base64,dGVzdA==');
    const completed = await GET(new Request('https://studio.example/api/generate-image?jobId=test'));
    assert.equal((await completed.json()).status, 'SUCCEEDED');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MAGNIFIC_API_KEY; else process.env.MAGNIFIC_API_KEY = originalKey;
  }
});
