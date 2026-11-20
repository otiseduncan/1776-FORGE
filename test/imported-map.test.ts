import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createApp} from './harness.ts';

test('all 127 published map records survive import; unknown locations stay unknown',async()=>{
 const app=createApp();const response=await app.call('GET','/api/map/features');
 const records=response.body.features;assert.equal(records.length,127);
 assert.equal(new Set(records.map((f:any)=>f.id)).size,127);
 assert.equal(records.filter((f:any)=>f.geometry).length,49);
 assert.equal(records.filter((f:any)=>f.geometry===null).length,78);
 assert.equal(new Set(records.flatMap((f:any)=>f.properties.county_ids)).size,33);
 assert.ok(records.every((f:any)=>f.properties.verification_state==='unreviewed'&&f.properties.condition_state==='gray'));
 const unknown=records.find((f:any)=>f.properties.title==='Pittman Construction Road Resurfacing');
 assert.equal(unknown.geometry,null);
 assert.equal((await app.call('GET','/api/map/features?condition=green')).body.features.length,0,'no new pavement rating inferred');
});

test('finance, contractor, source pages and original identities survive with their evidence distinctions',async()=>{
 const app=createApp();const d=await app.call('GET','/api/map/features/'+encodeURIComponent('legacy-map:project:research-01'));
 assert.equal(d.status,200);const r=d.body.feature.properties.legacy;
 assert.equal(r.id,'research-01');assert.equal(r.finance.rows.find((r:any)=>r.key==='contract').figs[0].cents,699890917);
 assert.equal(r.finance.details.find((d:any)=>d.label==='Contractor').value.text,'Dyer Construction');
 assert.equal(r.finance.rows.find((r:any)=>r.key==='paid').figs.length,0);
 assert.equal(r.finance.rows.find((r:any)=>r.key==='contract').figs[0].cite.page,38);
 assert.deepEqual(r.latlng,[33.093465090502214,-83.27707529067995]);
 const bonds=await app.call('GET','/api/map/features/'+encodeURIComponent('legacy-map:project:research-17'));
 assert.match(bonds.body.feature.properties.legacy.original_record.financial,/497,000,000/);
 assert.match(bonds.body.feature.properties.legacy.original_record.financial,/NOT county spending/);
});

test('map and main search find projects by contractor, county and exact dollar amount',async()=>{
 const app=createApp();
 for(const q of ['Dyer Construction','6,998,909.17','Aquatic']) {
   const r=await app.call('GET','/api/map/features?q='+encodeURIComponent(q));
   assert.ok(r.body.features.some((f:any)=>f.properties.title==='Aquatic Center'));
 }
 const county=await app.call('GET','/api/map/features?county=13169');
 assert.ok(county.body.features.length>0);assert.ok(county.body.features.every((f:any)=>f.properties.county_ids.includes('13169')));
 const global=await app.call('GET','/api/search?types=map&q=Dyer%20Construction');
 assert.ok(global.body.groups.map.some((f:any)=>f.title==='Aquatic Center'));
});

test('all preserved published map inputs and source text retain their original byte hashes',()=>{
 const root=new URL('../public/data/map-source/',import.meta.url);
 for(const manifest of ['manifest.json','transcript-manifest.json']) {
  const files=JSON.parse(readFileSync(new URL(manifest,root),'utf8')).files;
  for(const file of files) {
   const path=manifest==='manifest.json'?file.path.split('/').pop():file.path.replace(/^\//,'');
   const bytes=readFileSync(new URL(path,root));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
  }
 }
});
