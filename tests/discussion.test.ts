import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { before, beforeEach, after, test } from 'node:test';
import { getPayload, type Payload } from 'payload';
import { seed } from '../scripts/seed-community';
import { currentActor, writeContext, type Actor } from '../src/modules/access';
import { addAnnotation, createContent, submitDraft, decideSubmission, setVisibility } from '../src/modules/community';
import { addComment, changeComment, commentBody, commentHTML, discussion, moderate, ownComments, reports, reportTarget } from '../src/modules/discussion';
import { publicArticle } from '../src/modules/public-reading';
import { purgeContent, purgePreview, replayPurges } from '../src/modules/content-management';

let payload: Payload, member: Actor, other: Actor, admin: Actor, editor: Actor, server: ChildProcess;
let accounts: Record<string, { username: string; password: string }>;
const origin = 'http://127.0.0.1:3100';
const denied = (run: () => Promise<unknown>, codes = [400,401,403,404,409,410,429]) => assert.rejects(run, e => codes.includes((e as { status: number }).status));
const add = (content: number, actor = member, parent?: number, body = '合成评论 🌙') => addComment(payload, actor, { content, parent, body, requestKey: randomUUID() });
async function published(kind = 'post') {
  const markdown = kind === 'post' ? '字里行间，有故事。' : '## 开头\n开头\n## 简介\n简介\n## 正文\n字里行间，有故事。\n## 后记\n后记';
  const created = await createContent(payload, kind === 'post' ? member : editor, { slug: `p6-${randomUUID()}`, kind, title: 'P6 合成讨论样例', markdown });
  const submitted = await submitDraft(payload, kind === 'post' ? member : editor, Number(created.content.id), 1);
  const result = await decideSubmission(payload, admin, Number(submitted.id), 'approved');
  return { id: Number(created.content.id), slug: String(created.content.slug), snapshot: result.snapshot! };
}
async function raw(id: number) { return payload.findByID({ collection: 'comments', id, overrideAccess: true, depth: 0 }); }
async function http(path: string, cookie = '', input?: unknown, requestOrigin = origin) {
  return fetch(origin + path, { method: input === undefined ? 'GET' : 'POST', headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: input === undefined ? undefined : JSON.stringify(input), redirect: 'manual' });
}
before(async () => {
  const url = new URL(process.env.DATABASE_TEST_URL!); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/zifeiqiuyue_test');
  process.env.DATABASE_URL = url.toString(); process.env.MEDIA_ROOT = 'storage/test-media'; process.env.APP_ORIGIN = origin;
  const { default: config } = await import('../src/payload.config'); payload = await getPayload({ config }); accounts = await seed(payload, '.local/p1-test-accounts.json');
  const actor = async (name: string) => (await currentActor(payload, (await payload.find({ collection: 'users', where: { username: { equals: name } }, overrideAccess: true, depth: 0 })).docs[0]))!;
  admin = await actor('admin'); member = await actor('membera'); other = await actor('memberb'); editor = await actor('editor');
});
beforeEach(async () => { await payload.db.pool.query('DELETE FROM community.auth_limits'); });
after(async () => { server?.kill(); if (payload) await payload.destroy(); });

test('article and post comments support continuing replies and immutable parent/root ownership', async () => {
  for (const kind of ['article','post']) {
    const c = await published(kind), a = await add(c.id), b = await add(c.id, other, Number(a.id)), d = await add(c.id, member, Number(b.id));
    assert.equal((await raw(Number(d.id))).root, a.id); assert.equal((await raw(Number(d.id))).parent, b.id);
    const result = await discussion(payload, c.id, '1', Number(a.id), member); assert.equal(result.items.length, 2); assert.equal(result.thread!.id, a.id); assert.ok(result.thread!.own);
    const stranger = await published(); await denied(() => add(stranger.id, member, Number(a.id)), [400]);
    for (const data of [{ parent: d.id }, { root: d.id }, { author: other.id }, { content: stranger.id }]) await assert.rejects(() => payload.update({ collection: 'comments', id: a.id, data, context: writeContext(), overrideAccess: true }));
    await payload.db.pool.query('DELETE FROM community.auth_limits');
  }
});
test('duplicate concurrent submission returns one comment without consuming two quota slots', async () => {
  const c = await published(), input = { content: c.id, body: '只发布一次', requestKey: randomUUID() };
  const [a,b] = await Promise.all([addComment(payload, member, input), addComment(payload, member, input)]); assert.equal(a.id,b.id);
  await denied(() => addComment(payload, member, { ...input, body: '不同正文' }), [409]);
  assert.equal((await payload.count({ collection: 'comments', where: { content: { equals: c.id } }, overrideAccess: true })).totalDocs, 1);
});
test('comment input limits and Markdown escape HTML, scripts and image syntax', () => {
  for (const value of ['', '  ', 'a'.repeat(5001), '![图](https://example.com/a.png)', '![图](media:1)']) assert.throws(() => commentBody(value));
  assert.equal(commentBody('字'.repeat(5000)).length, 5000); assert.equal(commentBody('🌙 e\u0301'), '🌙 e\u0301');
  const html = commentHTML('<script>alert(1)</script>\n[x](javascript:alert(1))\n**粗体**'); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:')); assert.ok(html.includes('<strong>'));
});
test('author edits use revisions; others and lost revisions cannot overwrite', async () => {
  const c = await published(), a = await add(c.id);
  await denied(() => changeComment(payload, other, Number(a.id), { revision: 1, body: '偷改' }), [403]);
  const result = await Promise.allSettled([changeComment(payload, member, Number(a.id), { revision: 1, body: '版本甲' }), changeComment(payload, member, Number(a.id), { revision: 1, body: '版本乙' })]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await raw(Number(a.id))).revision, 2); assert.ok((await raw(Number(a.id))).editedAt);
});
test('deleted root retains replies, rejects direct replies and can never regain its body', async () => {
  const c = await published(), a = await add(c.id), b = await add(c.id, other, Number(a.id));
  await changeComment(payload, member, Number(a.id), { revision: 1 }, true);
  const result = await discussion(payload, c.id, '1', Number(a.id)); assert.equal(result.thread!.body, ''); assert.equal(result.items[0].id, b.id);
  await denied(() => add(c.id, other, Number(a.id)), [400]); await add(c.id, member, Number(b.id));
  await denied(() => changeComment(payload, member, Number(a.id), { revision: 2, body: '恢复正文' }), [409]);
  await moderate(payload, admin, { content: c.id, comment: a.id, action: 'restore', revision: 2, reason: '验证恢复不复活删除正文' }); assert.equal((await raw(Number(a.id))).body, '[已删除]');
});
test('hidden edits remain hidden and a hidden parent retains visible descendants', async () => {
  const c = await published(), a = await add(c.id), b = await add(c.id, other, Number(a.id));
  await moderate(payload, admin, { content: c.id, comment: a.id, action: 'hide', revision: 1, reason: '合成违规样例' });
  await changeComment(payload, member, Number(a.id), { revision: 2, body: 'HIDDEN-P6-EDIT' });
  const result = await discussion(payload, c.id, '1', Number(a.id)); assert.equal(result.thread!.body, ''); assert.ok(!JSON.stringify(result).includes('HIDDEN-P6-EDIT')); assert.equal(result.items[0].id, b.id);
  await denied(() => add(c.id, member, Number(a.id)), [400]);
  await moderate(payload, admin, { content: c.id, comment: a.id, action: 'restore', revision: 3, reason: '确认可见' }); assert.equal((await discussion(payload, c.id, '1', Number(a.id))).thread!.body, 'HIDDEN-P6-EDIT');
});
test('root and replies paginate independently in stable order', async () => {
  const c = await published(); let first = 0;
  for (let i = 0; i < 21; i++) { await payload.db.pool.query('DELETE FROM community.auth_limits'); const a = await add(c.id); first ||= Number(a.id); }
  assert.equal((await discussion(payload, c.id, '1')).items.length,20); assert.equal((await discussion(payload, c.id, '2')).items.length,1);
  for (let i = 0; i < 21; i++) { await payload.db.pool.query('DELETE FROM community.auth_limits'); await add(c.id, other, first); }
  const a = await discussion(payload, c.id, '1', first), b = await discussion(payload, c.id, '2', first); assert.equal(a.items.length,20); assert.equal(b.items.length,1); assert.ok(b.items[0].id>a.items[19].id);
  await denied(() => discussion(payload,c.id,'3',first),[404]);
});
test('speech limits share account quota between comments, replies and annotations', async () => {
  const c = await published(); for (let i=0;i<5;i++) await add(c.id);
  await denied(() => add(c.id), [429]);
  await denied(() => addAnnotation(payload,member,{snapshot:c.snapshot.id,start:0,end:1,quote:'字',body:'同一额度'}),[429]);
  assert.equal((await payload.count({ collection:'comments',where:{content:{equals:c.id}},overrideAccess:true })).totalDocs,5);
});
test('calendar-day and shared-IP counters enforce maxima and expired counters reset', async () => {
  const c = await published(); const hash = (await import('node:crypto')).createHash;
  const day = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  for (const key of [`speech:day:${day}:${member.id}`,'speech:ip:local:minute',`speech:ip:local:${day}`]) {
    await payload.db.pool.query('DELETE FROM community.auth_limits');
    await payload.db.pool.query('INSERT INTO community.auth_limits(bucket,count,expires_at,created_at,updated_at) VALUES($1,2000,now()+interval \'1 hour\',now(),now())',[hash('sha256').update(key).digest('hex')]);
    await denied(()=>add(c.id),[429]);
    await payload.db.pool.query("UPDATE community.auth_limits SET expires_at=now()-interval '1 second'"); await add(c.id);
  }
});
test('reports deduplicate pending targets, hide reporter details and enforce admin-only handling', async () => {
  const c = await published(), a = await add(c.id), input = {content:c.id,comment:a.id,reason:'举报合成内容'};
  await Promise.all([reportTarget(payload,other,input),reportTarget(payload,other,input)]);
  const list = await reports(payload,admin); const matches=list.items.filter(r=>r.content===c.id); assert.equal(matches.length,1);
  await denied(()=>reports(payload,member),[403]); await denied(()=>moderate(payload,editor,{...input,action:'hide',revision:1}),[403]);
  assert.ok(!JSON.stringify(await discussion(payload,c.id)).includes('reporter'));
  const r=matches[0]; const action={content:c.id,comment:a.id,report:r.id,reportRevision:1,action:'hide',revision:1,reason:'确认违规'};
  const handled=await Promise.allSettled([moderate(payload,admin,action),moderate(payload,admin,action)]); assert.equal(handled.filter(v=>v.status==='fulfilled').length,1);
  assert.equal((await raw(Number(a.id))).moderation,'hidden');
});
test('dismissal, content reports and audit records form a full handling loop', async () => {
  const c=await published(); await reportTarget(payload,member,{content:c.id,reason:'内容举报'});
  const r=(await reports(payload,admin)).items.find(r=>r.content===c.id)!;
  await moderate(payload,admin,{content:c.id,report:r.id,reportRevision:r.revision,action:'dismiss',reason:'检查无违规'});
  assert.equal((await payload.findByID({collection:'reports',id:r.id,overrideAccess:true})).status,'dismissed');
  await reportTarget(payload,member,{content:c.id,reason:'新的待处理举报'});
  assert.equal((await payload.count({collection:'content-events',where:{and:[{content:{equals:c.id}},{action:{equals:'discussion:dismiss'}}]},overrideAccess:true})).totalDocs,1);
});
test('locking stops comments, replies and annotations but retains edits and reporting', async () => {
  const c=await published(),a=await add(c.id); await moderate(payload,admin,{content:c.id,action:'lock',expected:'open',reason:'暂停新增'});
  await denied(()=>add(c.id),[409]); await denied(()=>add(c.id,other,Number(a.id)),[409]); await denied(()=>addAnnotation(payload,member,{snapshot:c.snapshot.id,start:0,end:1,quote:'字',body:'批注'}),[409]);
  await changeComment(payload,member,Number(a.id),{revision:1,body:'锁定仍可修正'}); await reportTarget(payload,other,{content:c.id,reason:'锁定仍可举报'});
  assert.equal((await discussion(payload,c.id)).items.length,1); await moderate(payload,admin,{content:c.id,action:'unlock',expected:'locked',reason:'恢复讨论'}); await add(c.id);
});
test('comment vs lock and reply vs delete races respect the shared content transaction', async () => {
  const c=await published(); const outcomes=await Promise.allSettled([add(c.id),moderate(payload,admin,{content:c.id,action:'lock',expected:'open',reason:'并发锁定'})]);
  assert.equal(outcomes[1].status,'fulfilled'); await denied(()=>add(c.id),[409]);
  await moderate(payload,admin,{content:c.id,action:'unlock',expected:'locked',reason:'解除'}); const a=await add(c.id);
  await Promise.allSettled([add(c.id,other,Number(a.id)),changeComment(payload,member,Number(a.id),{revision:1},true)]); assert.ok((await raw(Number(a.id))).deleted); await denied(()=>add(c.id,other,Number(a.id)),[400]);
});
test('parent hide blocks standalone discussion, author activity and annotation references', async () => {
  const c=await published(), a=await add(c.id); await addAnnotation(payload,member,{snapshot:c.snapshot.id,start:0,end:1,quote:'字',body:'旧批注关联'});
  await moderate(payload,admin,{content:c.id,action:'lock',expected:'open',reason:'独立锁定'}); await setVisibility(payload,admin,c.id,'hidden');
  await denied(()=>discussion(payload,c.id,'1',Number(a.id)),[404]); await denied(()=>add(c.id),[404]); await denied(()=>changeComment(payload,member,Number(a.id),{revision:1,body:'隐藏内容下写入'}),[404]);
  assert.ok(!(await ownComments(payload,member)).docs.some(d=>d.id===a.id));
  await setVisibility(payload,admin,c.id,'public'); assert.ok((await discussion(payload,c.id)).locked);
});
test('annotation comments preserve snapshot anchoring and share moderation and deletion', async () => {
  const c=await published('article'), snap=c.snapshot, chars=Array.from(snap.plainText), start=chars.indexOf('字');
  const a=await addAnnotation(payload,member,{snapshot:snap.id,start,end:start+1,quote:'字',body:'批注正文'}); assert.ok(a.comment); assert.equal(a.body,'批注正文');
  const publicNote=(await publicArticle(payload,c.slug)).annotations[0]; assert.equal(publicNote.body,'批注正文'); assert.equal(publicNote.comment,Number(a.comment));
  await moderate(payload,admin,{content:c.id,comment:a.comment,action:'hide',revision:1,reason:'隐藏批注'}); assert.equal((await publicArticle(payload,c.slug)).annotations.length,0);
  await changeComment(payload,member,Number(a.comment),{revision:2},true); const note=await payload.findByID({collection:'annotations',id:a.id,overrideAccess:true,depth:0}); assert.equal(note.quote,'[已删除]'); assert.equal(note.body,'');
});
test('annotation retries create one comment and one positioning record', async () => {
  const c=await published(), input={snapshot:c.snapshot.id,start:0,end:1,quote:'字',body:'重试批注',requestKey:randomUUID()};
  const [a,b]=await Promise.all([addAnnotation(payload,member,input),addAnnotation(payload,member,input)]); assert.equal(a.id,b.id); assert.equal(a.comment,b.comment);
  await denied(()=>addAnnotation(payload,member,{...input,body:'不同内容'}),[409]);
});
test('sensitive purge invalidates preview on discussion changes and scrubs reports and audit context', async () => {
  const c=await published(), marker=`P6-SENSITIVE-${randomUUID()}`,a=await add(c.id,member,undefined,marker);
  await reportTarget(payload,other,{content:c.id,comment:a.id,reason:marker}); const r=(await reports(payload,admin)).items.find(r=>r.content===c.id)!;
  await moderate(payload,admin,{content:c.id,comment:a.id,report:r.id,reportRevision:1,action:'hide',revision:1,reason:marker});
  const preview=await purgePreview(payload,admin,c.id); await changeComment(payload,member,Number(a.id),{revision:2,body:marker+'修改'});
  await denied(()=>purgeContent(payload,admin,c.id,{token:preview.token,confirm:'永久清除',reason:'合成清除'}),[409]);
  const latest=await purgePreview(payload,admin,c.id); await purgeContent(payload,admin,c.id,{token:latest.token,confirm:'永久清除',reason:'合成清除'});
  for(const table of ['comments','reports','content_events','annotations']) { const result=await payload.db.pool.query(`SELECT count(*)::int AS count FROM community.${table} t WHERE row_to_json(t)::text LIKE $1`,[`%${marker}%`]); assert.equal(result.rows[0].count,0,table); }
  await replayPurges(payload,admin); await denied(()=>discussion(payload,c.id),[404]);
});
test('banning via moderation revokes sessions and preserves the last-admin invariant', async () => {
  const c=await published(),a=await add(c.id,other);
  try { await moderate(payload,admin,{content:c.id,comment:a.id,action:'ban',reason:'验证封禁'}); await denied(()=>add(c.id,other),[403]); }
  finally { await payload.update({collection:'users',id:other.id,data:{status:'active'},context:writeContext(),overrideAccess:true}); }
  const root=await add(c.id,admin); await denied(()=>moderate(payload,admin,{content:c.id,comment:root.id,action:'ban',reason:'不能封禁最后管理员'}),[409]);
});
test('HTTP endpoints enforce sessions, origins, CRUD isolation and private responses', async () => {
  const log=fs.openSync('.local/p6-test-server.log','w'); server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env:{...process.env},stdio:['ignore',log,log],windowsHide:true}); fs.closeSync(log);
  let ready=false; for(let i=0;i<80;i++){try{if((await http('/api/community/session')).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,500));} assert.ok(ready,'test server did not start');
  const login=await http('/api/users/login','',accounts.membera); assert.equal(login.status,200); const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const c=await published(),input={content:c.id,body:'HTTP 合成评论',requestKey:randomUUID()};
  assert.equal((await http('/api/community/comment','',input)).status,401); assert.equal((await http('/api/community/comment',cookie,input,'https://example.org')).status,403);
  const added=await http('/api/community/comment',cookie,input); assert.equal(added.status,201); const a=await added.json();
  const read=await http(`/api/community/discussion?content=${c.id}`); assert.equal(read.status,200); assert.match(read.headers.get('cache-control')! ,/no-store/);
  assert.equal((await http('/api/community/reports',cookie)).status,403); assert.equal((await http('/api/comments',cookie)).status,403);
  assert.ok([401,403].includes((await http('/api/comments',cookie,{...input,author:member.id})).status));
  await reportTarget(payload,other,{content:c.id,comment:a.id,reason:'PRIVATE-REPORT-REASON'}); assert.ok(!JSON.stringify(await(await http(`/api/community/discussion?content=${c.id}`)).json()).includes('PRIVATE-REPORT-REASON'));
  await setVisibility(payload,admin,c.id,'hidden'); assert.equal((await http(`/api/community/discussion?content=${c.id}&root=${a.id}`,cookie)).status,404);
  const own=await(await http('/api/account/activity?type=comments',cookie)).json(); assert.ok(!own.docs.some((d:any)=>d.id===a.id));
});
