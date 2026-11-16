import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:8787';
const phase = process.env.QA_PHASE || 'before';
const snapshot = JSON.parse(await readFile('qa-artifacts/public-snapshot.json', 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: 'dark' });
// Public API snapshots replay real imported content against the local assets, without remote writes.
if (new URL(base).hostname === '127.0.0.1') {
  await page.route('**/api/home', r => r.fulfill({ json: snapshot.home }));
  await page.route('**/api/news?*', r => r.fulfill({ json: snapshot.news }));
  await page.route('**/api/news/*', async r => {
    const slug = new URL(r.request().url()).pathname.split('/').pop();
    const a = snapshot.articles.find(x => x.article.slug === slug);
    return a ? r.fulfill({json:a}) : r.continue();
  });
}
const widths = [1920,1440,1280,1024,768,430,375,320];
const paths = ['/', '/news', ...snapshot.articles.map(x => '/news/'+x.article.slug), '/records','/map','/government','/law','/law/us-bill-of-rights','/resources','/community','/community/new','/community/moderation-log','/news/series','/jurisdictions','/jurisdictions/ga-baldwin','/search?q=Fourteenth','/signin','/account','/notifications','/standards','/workspace','/admin','/records/missing','/missing'];
const results=[];
await mkdir('qa-artifacts', {recursive:true});
for (const width of widths) {
  await page.setViewportSize({width,height:1000});
  for (const path of paths) {
    const errors=[];
    const onError=e=>errors.push(e.message);
    page.on('pageerror',onError);
    await page.goto(base+path);
    await page.locator('.view:not([aria-busy])').waitFor({timeout:15000});
    await page.evaluate(()=>document.fonts.ready);
    const info=await page.evaluate(()=>{
      const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
      const overflow=[...document.querySelectorAll('main *, .header-inner *')].filter(e=>visible(e)&&e.getBoundingClientRect().right>innerWidth+2).slice(0,10).map(e=>({tag:e.tagName,cls:e.className,right:Math.round(e.getBoundingClientRect().right)}));
      const lead=document.querySelector('.lead-story');
      let overlap=null;
      if(lead){const a=lead.querySelector('.lead-media').getBoundingClientRect(),b=lead.querySelector('.lead-body').getBoundingClientRect();overlap={px:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),mediaWidth:a.width,bodyLeft:b.left};}
      return {pageOverflow:document.documentElement.scrollWidth-innerWidth,overflow,overlap,h1:document.querySelector('h1')?.textContent,bodyChars:document.querySelector('.article-main .prose')?.textContent.length};
    });
    results.push({width,path,...info,errors});
    if ((path==='/' && [1440,375,320].includes(width)) || (path==='/law' && width===320)) await page.screenshot({path:`qa-artifacts/${phase}-${path==='/law'?'law':'home'}-${width}.png`,fullPage:true});
    page.off('pageerror',onError);
  }
  console.log(width, JSON.stringify(results.filter(x=>x.width===width&&(x.pageOverflow>1||x.overlap?.px>1||x.errors.length)).map(x=>({path:x.path,overflow:x.pageOverflow,overlap:x.overlap?.px,errors:x.errors}))));
}
await writeFile(`qa-artifacts/${phase}-scan.json`,JSON.stringify(results,null,2));
await browser.close();
