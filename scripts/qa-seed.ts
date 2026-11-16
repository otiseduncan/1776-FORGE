// Explicitly local-only fixture setup; never accepts an environment/remote argument.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { TestD1 } from '../test/harness.ts';
if (process.argv.length > 2) throw Error('No arguments permitted: local QA fixtures only.');
const db = new TestD1().db;
const snap = JSON.parse(readFileSync('qa-artifacts/public-snapshot.json','utf8'));
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
const q = (v:unknown) => v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const sql:string[] = [];
function insert(table:string, value:Record<string,unknown>) {
  const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name));
  const pairs=Object.entries(value).filter(([k,v])=>cols.has(k)&&v!==undefined);
  sql.push(`INSERT INTO ${table} (${pairs.map(([k])=>k).join(',')}) VALUES (${pairs.map(([,v])=>q(v)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${pairs.filter(([k])=>k!=='id').map(([k])=>`${k}=excluded.${k}`).join(',')};`);
}
const at=new Date().toISOString();
insert('users',{id:'qa-owner',email:'qa-owner@example.test',display_name:'Disposable QA Owner',role:'owner',state:'active',email_verified:1,created_at:at});
insert('sessions',{id:createHash('sha256').update(token).digest('hex'),user_id:'qa-owner',csrf_token:csrf,created_at:at,expires_at:new Date(Date.now()+86400000).toISOString()});
const origin=snap.origin;
const get=async(p:string)=>{const r=await fetch(origin+p);if(!r.ok)throw Error(`${p}: ${r.status}`);return r.json() as Promise<any>;};
for(const x of snap.articles){
  insert('articles',{...x.article,author_id:'qa-owner',hero_media_id:null});
  if(x.series) insert('article_series',{...x.series,created_by:'qa-owner'});
  for(const d of x.documents){const data=await get('/api/records/'+d.id);insert('documents',{...data.document,original_storage_key:null,original_sha256:null,created_by:'qa-owner',verified_by:null});}
  for(const c of x.citations) insert('citations',{...c,subject_type:'article',subject_id:x.article.id,created_by:'qa-owner',verified_by:null});
  for(const d of x.documents) insert('content_links',{id:'qa-link-'+d.id,source_type:'article',source_id:x.article.id,target_type:'document',target_id:d.id,relationship:'evidence',created_by:'qa-owner'});
}
insert('discussions',{id:'qa-thread',context_type:'general',title:'Disposable QA discussion — layout and nested replies',body:'Local test data. A long link: https://example.test/'+ 'evidence'.repeat(30),created_by:'qa-owner',category_id:'general',moderation_state:'visible',comment_count:6,created_at:at,last_activity_at:at});
for(let i=0;i<6;i++) insert('comments',{id:'qa-comment-'+i,discussion_id:'qa-thread',parent_id:i?'qa-comment-'+(i-1):null,author_id:'qa-owner',body:'Disposable local reply '+i+' '+ 'longword'.repeat(30),moderation_state:'visible',created_at:at});
insert('article_series',{id:'qa-series',slug:'disposable-local-qa-series',title:'Disposable local QA series',kind:'series',status:'published',created_by:'qa-owner'});
insert('governing_bodies',{id:'qa-body',jurisdiction_id:'ga-baldwin',name:'Disposable local QA body',official_url:'https://example.test'});
insert('officials',{id:'qa-official',body_id:'qa-body',name:'Disposable local QA official',office:'Test office',source_url:'https://example.test'});
insert('meetings',{id:'qa-meeting',body_id:'qa-body',meeting_date:'2026-11-15',title:'Disposable local QA meeting',source_url:'https://example.test',created_by:'qa-owner'});
insert('budgets',{id:'qa-budget',jurisdiction_id:'ga-baldwin',fiscal_year:2027,stage:'proposed',title:'Disposable local QA budget',source_url:'https://example.test',created_by:'qa-owner'});
insert('budget_line_items',{id:'qa-budget-line',budget_id:'qa-budget',department:'Disposable QA department',line_type:'expenditure',description:'Synthetic local fixture',amount_cents:1234500});
mkdirSync('qa-artifacts',{recursive:true});
writeFileSync('qa-artifacts/fixture.sql',sql.join('\n'));
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--persist-to','.wrangler/qa-state','--file','qa-artifacts/fixture.sql'],{stdio:'pipe'});
writeFileSync('qa-artifacts/local-session.json',JSON.stringify({token,csrf,userId:'qa-owner'}));
console.log('Local QA owner, 4 public manuscripts, citations, record metadata and nested discussion seeded.');
// Store downloaded public originals in LOCAL R2 using the normal authenticated API.
const headers={'cookie':`__Host-forge_session=${token}`,'x-forge-csrf':csrf,'origin':'http://127.0.0.1:8798'};
for(const d of snap.records.items){
  const r=await fetch(origin+'/api/records/'+d.id+'/file');if(!r.ok)throw Error('Original download failed');
  const bytes=await r.arrayBuffer();
  const form=new FormData();form.set('file',new Blob([bytes],{type:'application/pdf'}),'original.pdf');
  const upload=await fetch('http://127.0.0.1:8798/api/records/'+d.id+'/file',{method:'POST',headers,body:form});
  if(!upload.ok)throw Error(await upload.text());
}
console.log('All 7 public original PDFs copied to local R2 through the upload API. Remote data untouched.');
for(const item of snap.articles){
  const a=item.article;if(!a.hero_url)continue;
  const r=await fetch(origin+a.hero_url);if(!r.ok)throw Error('Cover download failed');
  const form=new FormData();form.set('file',new Blob([await r.arrayBuffer()],{type:r.headers.get('content-type')||'image/png'}),'cover.png');
  form.set('alt_text',a.hero_alt||'Cover illustration supplied for this article.');form.set('is_illustration',String(a.hero_is_illustration));
  form.set('caption',a.hero_caption||'Cover illustration.');form.set('credit',a.hero_credit||'');
  const uploaded=await fetch('http://127.0.0.1:8798/api/media',{method:'POST',headers,body:form});if(!uploaded.ok)throw Error(await uploaded.text());
  const media=await uploaded.json() as {id:string};
  const saved=await fetch('http://127.0.0.1:8798/api/news/'+a.id,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({hero_media_id:media.id,change_note:'Local QA copy of current public cover.'})});
  if(!saved.ok)throw Error(await saved.text());
}
