export async function contentAPI(action: string, data?: unknown, method?: string) {
  const form = data instanceof FormData;
  const response = await fetch(`/api/community/${action}`, { method: method || (data === undefined ? 'GET' : 'POST'), cache: 'no-store', credentials: 'same-origin', headers: data === undefined || form ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : form ? data : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status === 409 ? '冲突：' : ''}${result.error || '操作未完成。'}`);
  return result;
}
