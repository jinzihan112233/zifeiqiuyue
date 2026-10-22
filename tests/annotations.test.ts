import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { before, beforeEach, after, test } from 'node:test';
import { parseHTML } from 'linkedom';
import { getPayload, type Payload } from 'payload';
import { annotationHref, annotationTextVersion, anchorRange, domPointOffset, findQuoteRanges, rangeAnchor, textAnchor } from '../src/modules/annotation-text';
import { annotationDetail, annotationList, annotationMarkers } from '../src/modules/annotations';
import { renderMarkdown, verifyAnnotationText } from '../src/modules/markdown';
import { addAnnotation, createContent, submitDraft, decideSubmission, saveDraft, setVisibility } from '../src/modules/community';
import { addComment, changeComment, moderate, ownComments } from '../src/modules/discussion';
import { publicArticle } from '../src/modules/public-reading';
import { purgeContent, purgePreview } from '../src/modules/content-management';
import { currentActor, writeContext, type Actor } from '../src/modules/access';
import { seed } from '../scripts/seed-community';

const sample = '## 开头\n\n合成测试。\n\n## 简介\n\n精确批注演示。\n\n## 正文\n\n重复句。**中文 🌙 e\u0301** [链接文字](https://example.com)。\n\n第二段，重复句。\n\n- 列表项\n\n| 列名 | 值 |\n| --- | --- |\n| 表格 | 正文 |\n\n`行内代码`\n\n## 后记\n\n测试结束。';
const cp = (text: string, utf16: number) => Array.from(text.slice(0, utf16)).length;
const denied = (fn: () => Promise<unknown>, codes = [400,401,403,404,409,410,429]) => assert.rejects(fn, e => codes.includes((e as {status:number}).status));
let payload: Payload, member: Actor, other: Actor, admin: Actor, editor: Actor, accounts: Record<string, {username:string;password:string}>, server: ChildProcess;
const origin = 'http://127.0.0.1:3100';
async function publish(kind: 'article'|'post' = 'article') {
  const actor = kind === 'article' ? editor : member;
  const value = await createContent(payload,actor,{kind,slug:`p7-${randomUUID()}`,title:'P7 合成版本',markdown:sample});
  const sub=await submitDraft(payload,actor,Number(value.content.id),1), approved=await decideSubmission(payload,admin,Number(sub.id),'approved');
  return { id:Number(value.content.id), slug:String(value.content.slug), snapshot:approved.snapshot!, actor, kind };
}
function input(snapshot: any, quote = '重复句。', last = false) {
  const text=String(snapshot.plainText), index=last?text.lastIndexOf(quote):text.indexOf(quote),start=cp(text,index);
  return {snapshot:snapshot.id,...textAnchor(text,start,start+Array.from(quote).length),rendererVersion:annotationTextVersion,body:'P7 合成批注',requestKey:randomUUID()};
}
async function http(path:string,cookie='',data?:unknown) { return fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'}); }
before(async()=>{
  const url=new URL(process.env.DATABASE_TEST_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/zifeiqiuyue_test');
  process.env.DATABASE_URL=url.toString();process.env.MEDIA_ROOT='storage/test-media';process.env.APP_ORIGIN=origin;
  const {default:config}=await import('../src/payload.config');payload=await getPayload({config});accounts=await seed(payload,'.local/p1-test-accounts.json');
  const actor=async(name:string)=>(await currentActor(payload,(await payload.find({collection:'users',where:{username:{equals:name}},depth:0,overrideAccess:true})).docs[0]))!;
  member=await actor('membera');other=await actor('memberb');admin=await actor('admin');editor=await actor('editor');
});
beforeEach(async()=>{await payload.db.pool.query('DELETE FROM community.auth_limits');});
after(async()=>{server?.kill();if(payload)await payload.destroy();});

test('v1 canonical text keeps rendered whitespace, headings, links and code without image alt',()=>{
  const value=renderMarkdown('## 标题\n\n中文 **粗体** 🌙 e\u0301\n\n[链接](https://example.com)\n\n![替代文字](media:1)\n\n`代码`',new Map([[1,'/file.webp']]));
  assert.equal(value.rendererVersion,annotationTextVersion);assert.equal(value.plainText,'标题\n中文 粗体 🌙 e\u0301\n链接\n\n代码\n');
  assert.ok(!value.plainText.includes('替代文字'));assert.ok(value.html.includes('alt="替代文字"'));
});
test('code point anchors reject invalid, whitespace and unknown-version ranges',()=>{
  const text='甲🌙e\u0301乙';assert.equal(textAnchor(text,1,2).quote,'🌙');assert.equal(textAnchor(text,2,4).quote,'e\u0301');
  assert.equal(textAnchor('🌙'.repeat(10000),0,10000).quote.length,20000);
  for(const [start,end]of [[-1,1],[0,0],[0,99],[0,NaN],[0.5,2],[0,Infinity]])assert.throws(()=>textAnchor(text,start,end));
  assert.throws(()=>textAnchor(' \n',0,2));assert.throws(()=>textAnchor(text,0,1,'unknown'));
});
test('DOM text and element boundaries convert UTF-16 offsets without splitting emoji',()=>{
  const {document}=parseHTML('<article>甲<strong>🌙é</strong><a href="/">乙</a>丙</article>'),root=document.querySelector('article')! as unknown as HTMLElement;
  const strong=root.querySelector('strong')!,node=strong.firstChild!;
  assert.equal(domPointOffset(root,node,2),2);assert.equal(domPointOffset(root,node,4),4);assert.equal(domPointOffset(root,root,2),4);
  assert.throws(()=>domPointOffset(root,node,1));assert.throws(()=>domPointOffset(root,node,99));assert.throws(()=>domPointOffset(root,document.createTextNode('外部') as unknown as Node,0));
});
test('cross-tag inverse mapping preserves text and DOM; native Range behavior is separately browser-tested',()=>{
  const {document}=parseHTML('<article>甲<strong>🌙é</strong><a href="/">乙</a>丙</article>'),root=document.querySelector('article')! as unknown as HTMLElement;
  // linkedom has no browser Range boundaries: this adapter checks only point arithmetic.
  document.createRange=(()=>({startContainer:root as Node,startOffset:0,endContainer:root as Node,endOffset:0,setStart(node:Node,offset:number){this.startContainer=node;this.startOffset=offset;},setEnd(node:Node,offset:number){this.endContainer=node;this.endOffset=offset;},intersectsNode(){return false;},collapsed:false})) as any;
  const before=root.innerHTML,anchor=textAnchor(root.textContent!,1,5),range=anchorRange(root,anchor,root.textContent!,annotationTextVersion);
  assert.equal(range.startOffset,0);assert.equal(range.endOffset,1);assert.equal(range.endContainer.parentElement!.tagName,'A');
  assert.deepEqual(rangeAnchor(root,range,root.textContent!,annotationTextVersion),anchor);assert.equal(root.innerHTML,before);
  assert.throws(()=>anchorRange(root,{...anchor,quote:'伪造'},root.textContent!,annotationTextVersion));assert.throws(()=>anchorRange(root,anchor,'页面不同',annotationTextVersion));
});
test('exact quote search exposes each repeated and overlapping location without normalization',()=>{
  const results=findQuoteRanges('🌙重复句。重复句。','重复句。');assert.equal(results.total,2);assert.deepEqual(results.items.map(a=>a.start),[1,5]);
  assert.equal(findQuoteRanges('aaaa','aa').total,3);assert.equal(findQuoteRanges('e\u0301','é').total,0);assert.throws(()=>findQuoteRanges('字'.repeat(105),'字','2' as unknown as number));
});
test('exact quote search paginates candidates and rejects invalid search input',()=>{
  assert.equal(findQuoteRanges('字'.repeat(105),'字',11).items.length,5);assert.equal(findQuoteRanges('字'.repeat(105),'字',2).items[0].start,10);
  assert.throws(()=>findQuoteRanges('正文','  '));assert.throws(()=>findQuoteRanges('正文','字'.repeat(5001)));assert.throws(()=>findQuoteRanges('正文','字',0));
});
test('server rejects image-spanning anchors and inconsistent saved HTML',()=>{
  const value=renderMarkdown('前文\n\n![说明](media:1)\n\n后文',new Map([[1,'/file.webp']]));
  assert.throws(()=>verifyAnnotationText(value.html,value.plainText,0,Array.from(value.plainText).length));assert.throws(()=>verifyAnnotationText(value.html,'伪造正文',0,1));
  assert.doesNotThrow(()=>verifyAnnotationText(value.html,value.plainText,0,2));
});
test('annotation links always preserve stable version, annotation and root discussion',()=>{
  assert.equal(annotationHref('/articles/a','version_1',7,8,'discussion'),'/articles/a?version=version_1&annotation=7&thread=8#discussion');
});
test('creation verifies reference, context and renderer for articles and posts',async()=>{
  for(const kind of ['article','post']as const){const c=await publish(kind),value=input(c.snapshot,'中文 🌙 e\u0301');const note=await addAnnotation(payload,member,value);assert.equal(note.quote,value.quote);assert.equal(note.prefix,value.prefix);assert.equal(note.suffix,value.suffix);
    for(const altered of [{quote:'错误引用'},{prefix:'错误前文'},{suffix:'错误后文'},{rendererVersion:'unknown'},{start:1,end:999999}])await denied(()=>addAnnotation(payload,member,{...value,...altered,requestKey:randomUUID()}));}
});
test('retries create one immutable anchor and one root comment',async()=>{
  const c=await publish(),value=input(c.snapshot);const [a,b]=await Promise.all([addAnnotation(payload,member,value),addAnnotation(payload,member,value)]);assert.equal(a.id,b.id);
  for(const fields of [{start:0},{end:1},{author:other.id},{quote:'偷换引用'},{prefix:'偷换上下文'},{snapshot:Number(c.snapshot.id)+1}])await assert.rejects(()=>payload.update({collection:'annotations',id:a.id,data:fields,context:writeContext(),overrideAccess:true}));
  await changeComment(payload,member,Number(a.comment),{revision:1,body:'只修改批注评论'});assert.equal((await annotationDetail(payload,c.id,Number(c.snapshot.id),a.id)).body,'只修改批注评论');
});
test('database rejects a positioning record attached to a reply or another content',async()=>{
  const c=await publish(),d=await publish();const root=await addComment(payload,member,{content:c.id,body:'根',requestKey:randomUUID()}),reply=await addComment(payload,member,{content:c.id,parent:root.id,body:'回复',requestKey:randomUUID()});
  const {body,rendererVersion,requestKey,...value}=input(c.snapshot);
  for(const data of [{...value,author:member.id,content:c.id,comment:reply.id},{...value,author:member.id,content:d.id,comment:root.id}])await assert.rejects(()=>payload.create({collection:'annotations',data,context:writeContext(),overrideAccess:true}));
});
test('pagination reaches beyond 100 annotations and direct lookup does not depend on the current page',async()=>{
  const c=await publish(),value=input(c.snapshot);const note=await addAnnotation(payload,member,value);
  await payload.db.pool.query(`WITH notes AS(INSERT INTO community.comments(author_id,content_id,body,created_at,updated_at) SELECT $1,$2,'分页合成批注',now(),now() FROM generate_series(1,104) RETURNING id)
    INSERT INTO community.annotations(author_id,content_id,snapshot_id,comment_id,start,"end",quote,prefix,suffix,created_at,updated_at) SELECT $1,$2,$3,id,$4,$5,$6,$7,$8,now(),now() FROM notes`,[member.id,c.id,c.snapshot.id,value.start,value.end,value.quote,value.prefix,value.suffix]);
  const first=await annotationList(payload,c.id,Number(c.snapshot.id),'1'),last=await annotationList(payload,c.id,Number(c.snapshot.id),'6');assert.equal(first.total,105);assert.equal(first.items.length,20);assert.equal(last.items.length,5);
  const highlights=await annotationMarkers(payload,c.id,Number(c.snapshot.id),'1');assert.equal(highlights.total,105);assert.equal(highlights.items.length,105);
  assert.deepEqual(Object.keys(highlights.items[0]).sort(),['comment','end','id','quote','snapshot','start','version']);
  assert.equal(highlights.items[0].quote,value.quote);await denied(()=>annotationMarkers(payload,c.id,Number(c.snapshot.id),'2'),[404]);
  assert.equal((await annotationDetail(payload,c.id,Number(c.snapshot.id),last.items[4].id)).id,last.items[4].id);assert.equal(first.items[0].id,Number(note.id));
  await denied(()=>annotationList(payload,c.id,Number(c.snapshot.id),'7'),[404]);
});
test('snapshot and content scoping prevents cross-version and cross-content lookups',async()=>{
  const c=await publish(),d=await publish(),note=await addAnnotation(payload,member,input(c.snapshot));
  await denied(()=>annotationDetail(payload,d.id,Number(c.snapshot.id),note.id),[404]);await denied(()=>annotationDetail(payload,c.id,Number(d.snapshot.id),note.id),[404]);await denied(()=>annotationList(payload,c.id,Number(d.snapshot.id)),[404]);await denied(()=>annotationMarkers(payload,d.id,Number(c.snapshot.id)),[404]);
});
test('new publication does not move annotations and old-version counts remain visible',async()=>{
  const c=await publish(),note=await addAnnotation(payload,member,input(c.snapshot,'重复句。',true));
  await saveDraft(payload,c.actor,c.id,{revision:1,title:'新标题',markdown:sample.replace('## 正文','## 正文\n\n新插入的一段。').replace('第二段，重复句。','第二段已经删除旧句。')});
  const sub=await submitDraft(payload,c.actor,c.id,2);await decideSubmission(payload,admin,Number(sub.id),'approved');
  const current=await publicArticle(payload,c.slug),old=await publicArticle(payload,c.slug,c.snapshot.stableId);assert.equal(current.annotations.length,0);assert.equal(old.annotations[0].id,Number(note.id));assert.equal(current.versions.find(v=>v.stableId===c.snapshot.stableId)!.annotations,1);
  await denied(()=>annotationDetail(payload,c.id,current.snapshot.id,note.id),[404]);
});
test('reply activity links inherit their root annotation version and preserve the thread',async()=>{
  const c=await publish('post'),note=await addAnnotation(payload,member,input(c.snapshot)),reply=await addComment(payload,other,{content:c.id,parent:note.comment,body:'批注回复',requestKey:randomUUID()});
  const entry=(await ownComments(payload,other)).docs.find(n=>Number(n.id)===Number(reply.id))!;assert.ok(entry.href.includes(`version=${c.snapshot.stableId}&annotation=${note.id}&thread=${note.comment}`));
});
test('hidden/deleted annotation references disappear while normal replies retain placeholders',async()=>{
  const c=await publish(),note=await addAnnotation(payload,member,input(c.snapshot));await addComment(payload,other,{content:c.id,parent:note.comment,body:'正常回复',requestKey:randomUUID()});
  await moderate(payload,admin,{content:c.id,comment:note.comment,action:'hide',revision:1,reason:'合成隐藏'});assert.equal((await annotationList(payload,c.id,Number(c.snapshot.id))).total,0);await denied(()=>annotationDetail(payload,c.id,Number(c.snapshot.id),note.id),[404]);
  await moderate(payload,admin,{content:c.id,comment:note.comment,action:'restore',revision:2,reason:'恢复'});await changeComment(payload,member,Number(note.comment),{revision:3},true);
  const raw=await payload.findByID({collection:'annotations',id:note.id,overrideAccess:true,depth:0});assert.equal(raw.quote,'[已删除]');assert.equal(raw.prefix,null);await denied(()=>annotationDetail(payload,c.id,Number(c.snapshot.id),note.id),[404]);
});
test('locking, hiding and sensitive purge remain authoritative for all annotation reads and writes',async()=>{
  const c=await publish(),note=await addAnnotation(payload,member,input(c.snapshot));await moderate(payload,admin,{content:c.id,action:'lock',expected:'open',reason:'合成锁定'});
  await denied(()=>addAnnotation(payload,member,input(c.snapshot)),[409]);await setVisibility(payload,admin,c.id,'hidden');await denied(()=>annotationList(payload,c.id,Number(c.snapshot.id)),[404]);await denied(()=>annotationDetail(payload,c.id,Number(c.snapshot.id),note.id),[404]);
  await setVisibility(payload,admin,c.id,'public');const preview=await purgePreview(payload,admin,c.id);await purgeContent(payload,admin,c.id,{token:preview.token,confirm:'永久清除',reason:'合成清除'});await denied(()=>annotationDetail(payload,c.id,Number(c.snapshot.id),note.id),[404]);
});
test('unknown renderer or mismatched saved text refuses new anchors without corrupting older ones',async()=>{
  const c=await publish(),value=input(c.snapshot),before=await addAnnotation(payload,member,value);
  try { await payload.db.pool.query("UPDATE community.snapshots SET renderer_version='future-unknown' WHERE id=$1",[c.snapshot.id]);await denied(()=>addAnnotation(payload,member,{...input(c.snapshot),rendererVersion:'future-unknown'}),[400]);
    assert.equal((await annotationDetail(payload,c.id,Number(c.snapshot.id),before.id)).quote,value.quote);
    await payload.db.pool.query('UPDATE community.snapshots SET renderer_version=$2,html=$3 WHERE id=$1',[c.snapshot.id,annotationTextVersion,'<p>不匹配</p>']);await denied(()=>addAnnotation(payload,member,input(c.snapshot)),[409]);
  } finally {await payload.db.pool.query('UPDATE community.snapshots SET renderer_version=$2,html=$3 WHERE id=$1',[c.snapshot.id,c.snapshot.rendererVersion,c.snapshot.html]);}
});
test('HTTP annotation projection, required version/context, direct links and no-store',async()=>{
  const log=fs.openSync('.local/p7-test-server.log','w');server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env:process.env,stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
  let ready=false;for(let i=0;i<80;i++){try{if((await http('/api/community/session')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'Server did not start; inspect .local/p7-test-server.log');
  const login=await http('/api/users/login','',accounts.membera);assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];const c=await publish(),value=input(c.snapshot);
  assert.equal((await http('/api/community/annotation',cookie,{...value,rendererVersion:undefined})).status,409);assert.equal((await http('/api/community/annotation',cookie,{...value,prefix:undefined})).status,409);
  const added=await http('/api/community/annotation',cookie,value);assert.equal(added.status,201);const note=await added.json();
  const response=await http(`/api/community/annotation-detail?content=${c.id}&snapshot=${c.snapshot.id}&id=${note.id}`);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);assert.ok(!JSON.stringify(await response.json()).includes('author'));
  assert.equal((await http(`/api/community/annotations?content=${c.id}&snapshot=${c.snapshot.id}&page=1&page=2`)).status,400);
  const html=await(await http(`/articles/${c.slug}?version=${c.snapshot.stableId}&annotation=${note.id}&thread=${note.comment}`)).text();assert.ok(html.includes('P7 合成版本'));assert.ok(html.includes('不用鼠标选字')===false,'Guest gets no creation form');
  await setVisibility(payload,admin,c.id,'hidden');assert.equal((await http(`/api/community/annotation-detail?content=${c.id}&snapshot=${c.snapshot.id}&id=${note.id}`,cookie)).status,404);
});
