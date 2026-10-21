import { APIError } from 'payload';

export async function bodyBytes(request: Request, limit: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (Number(request.headers.get('content-length')) > limit) { await reader?.cancel(); throw new APIError('请求过大。', 413); }
  if (reader) while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new APIError('请求过大。', 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
