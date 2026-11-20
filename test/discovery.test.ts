import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './harness.ts';
import type { Env } from '../src/env.ts';

test('search includes every archived jurisdiction, with safe links and no forwarded credentials', async () => {
  const requests: Request[] = [];
  const app = createApp({ LEGACY_RECORDS: { fetch: async (req: Request) => {
    requests.push(req);
    const url = new URL(req.url);
    if (!url.searchParams.has('q')) return Response.json({entities:[{jurisdiction_id:'putnam-ga'}],jurisdiction_scope:['baldwin-ga'],items:[],total:0});
    assert.equal(url.searchParams.get('q'), 'meeting minutes');
    assert.equal(url.searchParams.get('jurisdictions'), 'baldwin-ga,putnam-ga');
    return Response.json({items:[{id:'original-123',title:'Preserved meeting minutes',document_date:'2026-01-01',publisher:'County'}],total:160});
  } } as unknown as Env['LEGACY_RECORDS'] });
  const result = await app.call('GET','/api/search?q=meeting%20minutes');
  assert.equal(result.status,200);
  assert.equal(result.body.groups.archive[0].id,'original-123');
  assert.equal(result.body.archiveTotal,160);
  assert.equal(result.body.archiveAvailable,true);
  assert.equal(requests.length,2);
  for(const req of requests) {
    assert.equal(req.method,'GET');
    assert.equal(req.headers.get('cookie'),null);
    assert.equal(req.headers.get('authorization'),null);
  }
  const researcher = await app.user('researcher');
  await app.call('POST','/api/records',{user:researcher,body:{title:'Commission minutes',record_date:'2026-01-01',summary:'Public source'}});
  await app.call('POST','/api/records',{user:researcher,body:{title:'Private minutes',record_date:'2026-01-01',visibility:'staff'}});
  const byDate = await app.call('GET','/api/search?q=minutes%202026-01-01&types=records');
  assert.equal(byDate.body.groups.records.length,1);
  assert.equal(byDate.body.groups.records[0].title,'Commission minutes');
});

test('archive outage keeps other search results and reports incomplete coverage',async()=>{
  const app=createApp({LEGACY_RECORDS:{fetch:async()=>new Response('offline',{status:503})} as unknown as Env['LEGACY_RECORDS']});
  const result=await app.call('GET','/api/search?q=minutes');
  assert.equal(result.status,200);
  assert.equal(result.body.archiveAvailable,false);
  assert.ok(result.body.groups.law.length);
});

test('Episode 001 is discoverable as meeting coverage without publishing unrelated drafts',async()=>{
  const app=createApp();
  const videos=await app.call('GET','/api/civic/videos');
  assert.equal(videos.body.items[0].url,'https://www.youtube.com/watch?v=35QnvDaf61U');
  for(const q of ['minutes','Episode 001','Minute Watch Breakdown']) {
    const result=await app.call('GET','/api/search?types=videos&q='+encodeURIComponent(q));
    assert.equal(result.body.groups.videos.length,1);
  }
  assert.equal((await app.call('GET','/api/news')).body.total,0);
});
