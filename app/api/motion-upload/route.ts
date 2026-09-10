import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
const MAX_BYTES = 20 * 1024 * 1024;
export async function POST(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES + 65536) return Response.json({ error: 'El archivo debe pesar como máximo 20 MB.' }, {status:413});
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'].includes(file.type)) return Response.json({error:'Sube una imagen JPG, PNG o WebP, o un video MP4/MOV de hasta 20 MB.'},{status:400});
    const data = await file.arrayBuffer();
    const bytes = new Uint8Array(data);
    const tag = (offset: number, text: string) => Array.from(text).every((char,index) => bytes[offset+index] === char.charCodeAt(0));
    const valid = file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : file.type === 'image/png' ? bytes[0] === 137 && tag(1,'PNG') : file.type === 'image/webp' ? tag(0,'RIFF') && tag(8,'WEBP') : tag(4,'ftyp');
    if (!valid) return Response.json({error:'El contenido del archivo no coincide con el formato indicado.'},{status:400});
    const id = crypto.randomUUID();
    const kv = (env as unknown as { IMAGE_CACHE: { put(key:string,value:ArrayBuffer,options:unknown):Promise<void> } }).IMAGE_CACHE;
    await kv.put(id,data,{expirationTtl:86400,metadata:{mimeType:file.type}});
    return Response.json({url:`${new URL(request.url).origin}/api/image/${id}`},{headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'No se pudo subir el archivo. Inténtalo nuevamente.'},{status:502}); }
}
