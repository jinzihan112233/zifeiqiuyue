import { APIError, getPayload } from 'payload';
import config from '@payload-config';
import { currentActor } from '@/modules/access';
import { addAnnotation, createContent, decideSubmission, positiveId, previewDraft, saveDraft, setVisibility, submitDraft, uploadMedia } from '@/modules/community';
import { publicHome, requireEditor, saveHome, saveQuote } from '@/modules/editorial';
import { pageNumber, publicArchive, publicArticle } from '@/modules/public-reading';
import { bodyBytes } from '@/modules/http-body';
import { cleanupMedia, frozenPreview, managementDetail, managementList, purgeContent, purgePreview } from '@/modules/content-management';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function handle(request: Request, { params }: { params: Promise<{ action: string[] }> }) {
  try {
    const { action: [action, rawId] } = await params;
    const payload = await getPayload({ config });
    const auth = await payload.auth({ headers: request.headers });
    const actor = await currentActor(payload, auth.user);
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if (action === 'home') return json(await publicHome(payload));
      if (action === 'articles') return json(await publicArchive(payload, url.searchParams.getAll('page').length > 1 ? [] : url.searchParams.get('page')));
      if (action === 'posts') return json(await publicArchive(payload, url.searchParams.getAll('page').length > 1 ? [] : url.searchParams.get('page'), 'post'));
      if (action === 'public-article' || action === 'public-post') {
        if (url.searchParams.getAll('slug').length !== 1 || url.searchParams.getAll('version').length > 1) throw new APIError('文章标识无效。', 404);
        return json(await publicArticle(payload, url.searchParams.get('slug'), url.searchParams.get('version') ?? undefined, action === 'public-post' ? 'post' : 'article'));
      }
      if (['manage-list', 'manage-detail', 'frozen-preview', 'purge-preview'].includes(action)) {
        if (!actor) throw new APIError('请先登录。', 401);
        if (action === 'manage-list') return json(await managementList(payload, actor, url.searchParams.get('type') || 'contents', pageNumber(url.searchParams.get('page')), url.searchParams.get('status') || undefined, url.searchParams.get('kind') || undefined, url.searchParams.get('own') === 'true'));
        const id = positiveId(rawId);
        if (action === 'purge-preview') return json(await purgePreview(payload, actor, id));
        const submission = url.searchParams.get('submission');
        if (action === 'frozen-preview') return json(await frozenPreview(payload, actor, id, positiveId(submission)));
        return json(await managementDetail(payload, actor, id, submission ? positiveId(submission) : undefined));
      }
      if (action === 'editorial') {
        if (!actor) throw new APIError('请先登录。', 401);
        await requireEditor(payload, actor);
        const [quotes, home] = await Promise.all(['quotes', 'home'].map(collection => payload.find({ collection, overrideAccess: true, depth: 0, limit: 100, sort: 'id' })));
        const eligibleContents = []; let page = 1, more = true;
        while (more) { const result = await payload.find({ collection: 'contents', where: { and: [{ visibility: { equals: 'public' } }, { kind: { equals: 'article' } }] }, page, limit: 100, depth: 0, overrideAccess: true }); eligibleContents.push(...result.docs.map(c => ({ id: c.id, slug: c.slug, visibility: c.visibility, currentSnapshot: c.currentSnapshot }))); more = result.hasNextPage; page++; }
        return json({ quotes: quotes.docs.map(({ importState, ...q }) => q), home: home.docs.map(({ importState, ...h }) => h), eligibleContents });
      }
      if (action === 'session') return json({ user: actor ? { id: actor.id, nickname: actor.nickname, role: actor.role } : null });
      if (action === 'workspace') {
        if (!actor) throw new APIError('请先登录。', 401);
        const find = (collection: string) => payload.find({ collection, user: actor, overrideAccess: false, page: pageNumber(url.searchParams.get('page')), depth: 0, limit: 12, sort: ['-createdAt', '-id'] });
        const [contents, drafts, submissions, media] = await Promise.all(['contents', 'drafts', 'submissions', 'media'].map(find));
        return json({ contents: contents.docs, drafts: drafts.docs, submissions: submissions.docs, media: media.docs, pagination: Object.fromEntries([['contents', contents], ['drafts', drafts], ['submissions', submissions], ['media', media]].map(([key, result]) => [key, { page: (result as typeof contents).page, pages: (result as typeof contents).totalPages }])) });
      }
      if (action === 'reader') {
        const contentId = positiveId(url.searchParams.get('content'));
        const content = await payload.findByID({ collection: 'contents', id: contentId, user: actor, overrideAccess: false, depth: 0, disableErrors: true });
        if (!content || content.visibility !== 'public' && actor?.role !== 'admin') throw new APIError('内容不可用。', 404);
        const snapshotId = positiveId(url.searchParams.get('snapshot') || content.currentSnapshot);
        const snapshot = await payload.findByID({ collection: 'snapshots', id: snapshotId, user: actor, overrideAccess: false, depth: 0, disableErrors: true });
        if (!snapshot || Number(snapshot.content) !== contentId) throw new APIError('版本不可用。', 404);
        const annotations = await payload.find({ collection: 'annotations', where: { snapshot: { equals: snapshotId } }, user: actor, overrideAccess: false, depth: 0, limit: 100 });
        return json({ content, snapshot, annotations: annotations.docs });
      }
      throw new APIError('接口不存在。', 404);
    }
    if (!['POST', 'PATCH'].includes(request.method)) throw new APIError('不支持的操作。', 405);
    if (request.headers.get('origin') !== (process.env.APP_ORIGIN || 'http://127.0.0.1:3000')) throw new APIError('请求来源不可信。', 403);
    if (!actor) throw new APIError('请先登录。', 401);
    if (action === 'cleanup') return json(await cleanupMedia(payload, actor));
    if (action === 'media' && request.method === 'POST') {
      const bytes = await bodyBytes(request, 6 * 1024 * 1024);
      const form = await new Response(bytes, { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData();
      const file = form.get('file');
      if (!(file instanceof File)) throw new APIError('请选择图片。', 400);
      return json(await uploadMedia(payload, actor, Buffer.from(await file.arrayBuffer()), String(form.get('alt') || '')));
    }
    let input: Record<string, unknown>;
    try { input = JSON.parse((await bodyBytes(request, 256 * 1024)).toString('utf8')); }
    catch (error) { if (error instanceof APIError) throw error; throw new APIError('请求格式无效。', 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new APIError('请求格式无效。', 400);
    if (action === 'content' && request.method === 'POST') return json(await createContent(payload, actor, input), 201);
    if (action === 'preview' && request.method === 'POST') return json(await previewDraft(payload, actor, input.markdown, input.content ? positiveId(input.content) : undefined));
    if (action === 'annotation' && request.method === 'POST') return json(await addAnnotation(payload, actor, input), 201);
    if (action === 'quote' && request.method === 'POST') return json(await saveQuote(payload, actor, input));
    if (action === 'home' && request.method === 'POST') return json(await saveHome(payload, actor, input));
    const id = positiveId(rawId);
    if (action === 'draft' && request.method === 'PATCH') return json(await saveDraft(payload, actor, id, input));
    if (action === 'purge' && request.method === 'POST') return json(await purgeContent(payload, actor, id, input));
    if (action === 'submit' && request.method === 'POST') return json(await submitDraft(payload, actor, id, input.revision, input.requestKey, input.reason), 201);
    if (action === 'decision' && request.method === 'POST') {
      if (!['approved', 'returned', 'withdrawn'].includes(String(input.decision))) throw new APIError('审核决定无效。', 400);
      return json(await decideSubmission(payload, actor, id, input.decision as 'approved' | 'returned' | 'withdrawn', typeof input.reason === 'string' ? input.reason : '', typeof input.expectedStatus === 'string' ? input.expectedStatus : 'pending', typeof input.requestKey === 'string' ? input.requestKey : undefined, typeof input.internalNote === 'string' ? input.internalNote : ''));
    }
    if (action === 'visibility' && request.method === 'POST') {
      if (input.visibility !== 'public' && input.visibility !== 'hidden') throw new APIError('状态无效。', 400);
      return json(await setVisibility(payload, actor, id, input.visibility, typeof input.reason === 'string' ? input.reason : '', typeof input.expectedStatus === 'string' ? input.expectedStatus : undefined));
    }
    throw new APIError('接口不存在。', 404);
  } catch (error) {
    if (error instanceof APIError) return json({ error: error.message }, error.status);
    console.error('Community request failed:', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: '操作失败，请重试或查看服务端检查记录。' }, 500);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
