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
      if (String(url).includes('/api/v1/userText2image/')) {
        return Response.json({ data: { current_status: 'completed', image_urls: ['https://example.com/1.png'] } });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    };

    const created = await POST(request({ prompt: 'Create a portrait', model: 'qwen', count: 1 }));
    assert.equal(created.status, 200);
    assert.match((await created.json()).jobId, /^[a-f0-9-]+$/i);
    assert.equal(posted[0].url, 'https://video.a2e.ai/api/v1/userText2image/start');
    assert.equal(posted[0].body.req_key, 'high_aes_general_v21_L');
    assert.equal(posted[0].body.width, 1024);

    const completed = await GET(new Request('https://studio.example/api/generate-image?jobId=test'));
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).images.length, 1);

    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.input_images[0].startsWith('https://studio.example/api/image/'));
      return Response.json({ data: { _id: 'nano-task' } });
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
