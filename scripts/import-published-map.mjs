// Rebuild the read-only native map catalogue from the preserved site's published inputs.
// Usage: node scripts/import-published-map.mjs <absolute legacy public directory> [public source origin]
// No database, bucket, DNS or legacy source mutations are performed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]||'');const origin=process.argv[3];
if(!process.argv[2])throw Error('Pass the preserved public directory explicitly.');
const target=resolve('public/data/map-source');
if(root===target||root.startsWith(target+'/'))throw Error('Source and destination must be separate.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const network=globalThis.fetch;const files=[];
const verify=async(path,bytes)=>{
 if(origin){const r=await network(new URL(path,origin));if(!r.ok)throw Error(path+' HTTP '+r.status);if(sha(Buffer.from(await r.arrayBuffer()))!==sha(bytes))throw Error('Source drift: '+path);}
};
globalThis.fetch=async path=>{
 const bytes=await readFile(join(root,String(path)));await verify(String(path),bytes);
 files.push({path:String(path),bytes:bytes.length,sha256:sha(bytes),...(origin?{live_sha256:sha(bytes)}:{})});
 return new Response(bytes,{headers:{'content-type':'application/json'}});
};
let records,state;
try {const mod=await import(pathToFileURL(join(root,'app/data.js')).href);records=await mod.loadRecords();state=mod.state;}
finally {globalThis.fetch=network;}
if(records.length!==127||new Set(records.map(r=>r.key)).size!==127)throw Error('Catalogue changed: reconcile counts and IDs before replacing the snapshot.');
const originalRows=[];
for(const name of ['roads.json','projects.json','jones-projects.json','regional-projects.json','coverage-projects.json']) {
 const data=JSON.parse(await readFile(join(root,name),'utf8'));
 originalRows.push(...(Array.isArray(data)?data:data.projects||data.records||[]));
}
const originals=new Map(originalRows.map(r=>[r.id,r]));
for(const record of records)record.original_record=originals.get(record.id)||null;
await mkdir(target,{recursive:true});
for(const file of files)await writeFile(join(target,basename(file.path)),await readFile(join(root,file.path)));
await writeFile(join(target,'manifest.json'),JSON.stringify({imported_on:'2026-11-20',source_origin:origin||null,normalizer_sha256:sha(await readFile(join(root,'app/data.js'))),files},null,2));
const counties=new Set(records.flatMap(r=>r.counties));
const outlines=JSON.parse(await readFile(join(root,'ga-county-coverage.json'),'utf8'));
await writeFile('public/data/project-counties.json',JSON.stringify({type:'FeatureCollection',features:outlines.features.filter(f=>counties.has(f.properties.GEOID))}));
await writeFile('src/data/imported-map-records.ts','// Preserved public map records. Generated from hash-verified source inputs; retain financial labels and evidence limits.\nimport type { ImportedMapRecord } from "../lib/imported-map.ts";\nexport const importedMapRecords: ImportedMapRecord[] = '+JSON.stringify(records)+';\n');
const transcriptFiles=[];await mkdir(join(target,'transcripts'),{recursive:true});
for(const d of [...state.documents.values()].filter(d=>d.text_available)) {
 const path='/transcripts/'+d.id+'.json';const bytes=await readFile(join(root,path));await verify(path,bytes);
 await writeFile(join(target,path),bytes);transcriptFiles.push({path,bytes:bytes.length,sha256:sha(bytes)});
}
await writeFile(join(target,'transcript-manifest.json'),JSON.stringify({files:transcriptFiles},null,2));
await writeFile('public/js/core/map-source-text.js','export const sourceTextIds = new Set('+JSON.stringify(transcriptFiles.map(f=>basename(f.path,'.json')))+');\n');
console.log(JSON.stringify({records:records.length,located:records.filter(r=>r.latlng||r.lines?.length).length,counties:counties.size,sourceTexts:transcriptFiles.length,liveHashesChecked:!!origin}));
