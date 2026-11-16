import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const base=process.env.QA_BASE_URL||'http://127.0.0.1:8798';
const dir=process.env.QA_SCREENSHOT_DIR||'qa-artifacts';
await mkdir(dir,{recursive:true});
const b=await chromium.launch();
const p=await b.newPage({colorScheme:'dark'});
const ready=async path=>{await p.goto(base+path);await p.locator('.view:not([aria-busy])').waitFor();await p.evaluate(()=>document.fonts.ready);};
for(const width of [1920,1440,1280,1024,768,430,375,320]){
  await p.setViewportSize({width,height:1000});await ready('/');
  await p.locator('.front-page img').evaluateAll(imgs=>Promise.all(imgs.map(img=>{img.loading='eager';return img.decode().catch(()=>{});})));
  await p.screenshot({path:`${dir}/after-home-${width}.png`});
  await p.locator('.front-page').screenshot({path:`${dir}/after-featured-${width}.png`});
}
for(const path of ['/news/harry-keim-dismissed-systemwide-failure-or-one-man-blamed','/law','/map','/records']){
  await p.setViewportSize({width:375,height:1000});await ready(path);
  await p.screenshot({path:`${dir}/after-${path.split('/').pop()}-375.png`});
}
if(new URL(base).hostname==='127.0.0.1'){
  const s=JSON.parse(await readFile('qa-artifacts/local-session.json','utf8'));
  await p.context().addCookies([{name:'__Host-forge_session',value:s.token,domain:'127.0.0.1',path:'/',secure:true}]);
  for(const path of ['/community/t/qa-thread','/workspace/articles','/workspace/articles/new','/admin/moderation']){
    await p.setViewportSize({width:320,height:1000});await ready(path);await p.screenshot({path:`${dir}/after-local-${path.split('/').pop()}-320.png`});
    if(path.endsWith('/qa-thread'))await p.locator('.thread').screenshot({path:`${dir}/after-local-nested-replies-320.png`});
  }
}
await b.close();console.log('Captured all 8 viewport widths and representative detail/workspace pages.');
