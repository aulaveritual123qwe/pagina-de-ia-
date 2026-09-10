import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../app/api/generate-image/route.ts', import.meta.url), 'utf8')
  .replace("import { env } from 'cloudflare:workers';", 'const env = { IMAGE_CACHE: { put: async () => {} } };')
  .replace("import { imageExpiresAt } from '@/lib/image-retention';", 'const imageExpiresAt = () => Date.now() + 86400000;');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { POST } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
test('image reference uses one batch, retains all results and hides service errors', async () => {
 const originalFetch=globalThis.fetch, originalKey=process.env.QWEN_API_KEY;
 process.env.QWEN_API_KEY='test-only';
 const request=()=>new Request('https://studio.example/api/generate-image',{method:'POST',body:JSON.stringify({prompt:'Change the background',model:'qwen',referenceImage:'data:image/png;base64,test',count:2})});
 try {
  let calls=0;
  globalThis.fetch=async (url,options)=>{
   if(options?.method==='POST') {
    calls++; const body=JSON.parse(options.body);
    assert.equal(body.parameters.n,2); assert.equal(body.model,'qwen-image-3.0-pro'); assert.ok(options.signal);
    assert.equal(body.input.messages[0].content[0].image,'data:image/png;base64,test');
    return Response.json({output:{choices:[{message:{content:[{image:'https://example.com/1.png'},{image:'https://example.com/2.png'}]}}]}});
   }
   return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
  };
  const response=await POST(request()); assert.equal(response.status,200); assert.equal((await response.json()).images.length,2); assert.equal(calls,1);
  globalThis.fetch=async()=>Response.json({message:'Qwen internal error; reference = test'},{status:500});
  const failed=await POST(request()); assert.equal(failed.status,500); assert.doesNotMatch((await failed.json()).error,/Qwen|reference =/);
 } finally { globalThis.fetch=originalFetch; if(originalKey===undefined) delete process.env.QWEN_API_KEY; else process.env.QWEN_API_KEY=originalKey; }
});
