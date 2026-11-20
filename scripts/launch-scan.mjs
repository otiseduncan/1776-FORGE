import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.QA_BASE_URL || 'https://baldwinminutewatch.org';
const phase = process.env.QA_PHASE || 'before';
await mkdir('qa-artifacts', {recursive:true});
const browser = await chromium.launch();
const page = await browser.newPage();
const paths = ['/', '/government', '/government?tab=bodies', '/government?tab=budgets', '/records', '/legacy/records?q=minutes', '/legacy/records?classification=meeting_packet', '/search?q=minutes', '/news', '/map', '/community', '/law', '/resources', '/about', '/signin'];
const results=[];
for(const width of [320,375,390,430,768,1024,1440,1920]) {
 await page.setViewportSize({width,height:950});
 for(const path of paths) {
  const errors=[]; const handler=e=>errors.push(e.message); page.on('pageerror',handler);
  try {
   await page.goto(base+path);
   await page.locator('.view:not([aria-busy])').waitFor({timeout:25000});
   await page.evaluate(()=>document.fonts.ready);
   const info=await page.evaluate(()=>({h1:document.querySelector('h1')?.textContent, overflow:document.documentElement.scrollWidth-innerWidth, offenders:[...document.querySelectorAll('main *,header *')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+2).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,65)})), text:document.querySelector('main')?.innerText.slice(0,650)}));
   results.push({width,path,...info,errors});
   if([320,1440].includes(width)&&['/','/government','/search?q=minutes'].includes(path)) await page.screenshot({path:`qa-artifacts/${phase}-${path==='/'?'home':path.startsWith('/government')?'meetings':'search'}-${width}.png`,fullPage:true});
  } catch(e) {results.push({width,path,error:e.message,errors});}
  page.off('pageerror',handler);
 }
 console.log(JSON.stringify({width,issues:results.filter(x=>x.width===width&&(x.overflow>1||x.errors?.length||x.error))}));
}
await writeFile(`qa-artifacts/${phase}-scan.json`,JSON.stringify(results,null,2));
await browser.close();
