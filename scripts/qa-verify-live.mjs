import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const before=JSON.parse(await readFile('qa-artifacts/public-snapshot.json','utf8'));
const origin=before.origin;
const results={checkedAt:new Date().toISOString(),origin,articles:[],pdfs:[],authConfigured:false};
for(const old of before.articles){
  const response=await fetch(origin+'/api/news/'+old.article.slug);assert.equal(response.status,200);
  const current=await response.json();
  for(const k of ['id','slug','title','category_id','summary','excerpt','body','byline','author_id','published_at','original_published_at','updated_at','hero_url'])assert.deepEqual(current.article[k],old.article[k],`${old.article.slug}: ${k} changed`);
  assert.deepEqual(current.citations,old.citations,'Citations changed');assert.deepEqual(current.documents,old.documents,'Source document links changed');
  const page=await fetch(origin+'/news/'+old.article.slug);assert.equal(page.status,200);
  results.articles.push({slug:old.article.slug,bodySha256:createHash('sha256').update(current.article.body).digest('hex'),unchanged:true});
}
for(const record of before.records.items){
  const r=await fetch(origin+'/api/records/'+record.id+'/file');assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'),/application\/pdf/);
  const hash=createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
  assert.equal(hash,record.original_sha256,'Original PDF changed');
  results.pdfs.push({id:record.id,sha256:hash,unchanged:true});
}
const config=await(await fetch(origin+'/api/config')).json();assert.equal(config.authConfigured,true);results.authConfigured=true;
const me=await(await fetch(origin+'/api/me')).json();assert.equal(me.user,null);
for(const path of ['/api/workspace/articles','/api/admin/overview']){const r=await fetch(origin+path);assert.equal(r.status,401,'Anonymous privileged access');}
const unknown=await fetch(origin+'/api/qa-route-does-not-exist');assert.equal(unknown.status,404);
const root=await fetch(origin);assert.equal(root.status,200);results.httpsStatus=root.status;
await writeFile('qa-artifacts/live-integrity.json',JSON.stringify(results,null,2));
console.log(`HTTPS 200; ${results.articles.length} article bodies/metadata/citations unchanged; ${results.pdfs.length} original PDF hashes match; auth configured; anonymous privileged reads denied.`);
