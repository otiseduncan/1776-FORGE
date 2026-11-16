// Compare the deployed assets to a known Git revision before releasing changes.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const ref=process.argv[2]||'HEAD';
const files=execFileSync('git',['ls-tree','-r','--name-only',ref,'public'],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.endsWith('/_headers'));
const results=[];
for(const path of files){
  const source=execFileSync('git',['show',`${ref}:${path}`]);
  const r=await fetch('https://1776-forge.otiseduncan.workers.dev/'+path.slice(7));
  const remote=Buffer.from(await r.arrayBuffer());
  const text=/\.(js|css|html)$/.test(path);
  const hash=x=>createHash('sha256').update(text?x.toString().replaceAll('\r\n','\n'):x).digest('hex');
  results.push({path,status:r.status,matches:r.ok&&hash(source)===hash(remote)});
}
await writeFile('qa-artifacts/deployed-source-comparison.json',JSON.stringify({ref,results},null,2));
console.log(JSON.stringify({ref,compared:results.length,mismatches:results.filter(x=>!x.matches)},null,2));
if(results.some(x=>!x.matches))process.exitCode=1;
