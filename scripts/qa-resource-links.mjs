// Read-only availability probe. A blocked automated request is not proof of a broken source.
import { writeFile } from 'node:fs/promises';
const data=await(await fetch('https://1776-forge.otiseduncan.workers.dev/api/resources')).json();
const results=[];
const items=[...data.items];
await Promise.all(Array.from({length:4},async()=>{
  while(items.length){
    const item=items.shift();
    try{
      const url=item.url;
      if(!/^https:\/\//.test(url))throw Error('Expected HTTPS');
      let r=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(12000)});
      if(r.status===405){r=await fetch(url,{signal:AbortSignal.timeout(12000)});await r.body?.cancel();}
      results.push({name:item.name,url,status:r.status,finalUrl:r.url});
    }catch(e){results.push({name:item.name,url:item.url,error:e.message});}
  }
}));
await writeFile('qa-artifacts/resource-links.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({total:results.length,ok:results.filter(x=>x.status>=200&&x.status<400).length,unverified:results.filter(x=>!(x.status>=200&&x.status<400))},null,2));
