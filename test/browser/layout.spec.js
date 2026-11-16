import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const widths=[1920,1440,1280,1024,768,430,375,320];
const local = !process.env.QA_BASE_URL || ['127.0.0.1','localhost'].includes(new URL(process.env.QA_BASE_URL).hostname);
async function ready(page,path){if(process.env.QA_VERBOSE)console.log('Checking',path);await page.goto(path);await page.locator('.view:not([aria-busy])').waitFor();await page.evaluate(()=>document.fonts.ready);}
async function layout(page){
  const problems=await page.evaluate(()=>{
    const out=[];
    if(document.documentElement.scrollWidth>innerWidth+1)out.push(`Page overflow: ${document.documentElement.scrollWidth-innerWidth}px`);
    const rect=e=>e.getBoundingClientRect();
    for(const lead of document.querySelectorAll('.lead-story')){
      const a=rect(lead.querySelector('.lead-media')),b=rect(lead.querySelector('.lead-body'));
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)out.push('Lead media overlaps story text');
      const bounds=rect(lead);
      for(const e of lead.querySelectorAll('.lead-body, h2, p, .lead-plate, .lead-plate strong')){const r=rect(e);if(r.left<bounds.left-1||r.right>bounds.right+1||r.bottom>bounds.bottom+1)out.push('Lead content leaves card: '+e.className);}
    }
    for(const grid of document.querySelectorAll('.grid')){
      const cards=[...grid.children].filter(x=>x.matches('.card')).map(rect);
      for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){const a=cards[i],b=cards[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)out.push('Cards overlap');}
    }
    // Scrollable tables, map tiles and navigation strips have intentional local overflow.
    for(const e of document.querySelectorAll('h1,h2,h3,.article-main .prose p,.story-card p,.comment-body')){
      if(e.closest('.table-wrap')||!e.getClientRects().length)continue;
      const r=rect(e); if(r.left< -1||r.right>innerWidth+1||e.scrollWidth>e.clientWidth+2)out.push('Clipped text: '+e.textContent.slice(0,70));
    }
    return out;
  });
  expect(problems).toEqual([]);
}
async function publicPaths(request){
  const get=async p=>{const r=await request.get(p);expect(r.ok(),p).toBeTruthy();return r.json();};
  const news=await get('/api/news?pageSize=100'),records=await get('/api/records?pageSize=100'),law=await get('/api/law'),series=await get('/api/series'),forum=await get('/api/forum/discussions');
  const paths=['/','/news','/news?kind=report','/news?q=zzzznotfound','/news/series','/records','/records?q=zzzznotfound','/map','/government','/law','/resources','/community','/community/new','/community/moderation-log','/jurisdictions','/jurisdictions/ga-baldwin','/search?q=Fourteenth','/search?q=zzzznotfound','/signin','/account','/notifications','/standards','/workspace','/admin','/records/missing','/news/missing','/missing'];
  paths.push(...news.items.map(x=>'/news/'+x.slug),...records.items.map(x=>'/records/'+x.id),...law.items.map(x=>'/law/'+x.id),...series.items.map(x=>'/news/series/'+x.slug),...forum.items.map(x=>'/community/t/'+x.id));
  if(local)paths.push('/government/meetings/qa-meeting','/government/bodies/qa-body','/government/officials/qa-official','/government/budgets/qa-budget');
  if(news.items[0]?.author_id)paths.push('/authors/'+news.items[0].author_id);
  return {paths,news,records};
}
for(const width of widths){
  test(`public routes at ${width}px`,async({page,request})=>{
    await page.setViewportSize({width,height:1000});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {paths}=await publicPaths(request);
    for(const path of paths){await test.step(path,async()=>{await ready(page,path);await expect(page.locator('main h1')).toBeVisible();await layout(page);});}
    expect(errors).toEqual([]);
  });
  test(`local owner workspace at ${width}px`,async({page,context})=>{
    test.skip(!local,'Local fixtures never authenticate to a deployed application.');
    const s=JSON.parse(await readFile('qa-artifacts/local-session.json','utf8'));
    await context.addCookies([{name:'__Host-forge_session',value:s.token,domain:'127.0.0.1',path:'/',secure:true,sameSite:'Lax'}]);
    await page.setViewportSize({width,height:1000});
    await ready(page,'/account');expect((await (await page.request.get('/api/me')).json()).user?.id).toBe('qa-owner');
    const paths=['/','/account','/notifications','/records/new','/community/new','/community/t/qa-thread','/workspace','/workspace/articles','/workspace/records','/workspace/map','/workspace/civic','/workspace/articles/new','/admin','/admin/moderation','/admin/users','/admin/audit','/admin/imports'];
    const data=await (await page.request.get('/api/news')).json();paths.push(...data.items.map(x=>'/workspace/articles/'+x.id));
    for(const path of paths){await test.step(path,async()=>{await ready(page,path);await layout(page);});}
    await ready(page,'/workspace/articles/new');
    await page.getByLabel('Body (Markdown)',{exact:false}).fill('![Unsupported external image](https://example.test/image.png)\n\n## Preview survived\n\n'+ 'longword'.repeat(70));
    await expect(page.getByRole('heading',{name:'Preview survived'})).toBeVisible();await layout(page);
    await ready(page,'/workspace/articles/'+data.items[0].id);
    await page.getByRole('button',{name:'Choose from library'}).click();await expect(page.getByRole('dialog')).toBeVisible();
    const r=await page.getByRole('dialog').boundingBox();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(width+1);await page.getByRole('button',{name:'Close',exact:true}).click();
  });
}
test('lead story content variants, both themes and all widths',async({page,request})=>{
  const home=await (await request.get('/api/home')).json();
  const original=home.featured[0]||home.latest[0];expect(original).toBeTruthy();
  for(const width of widths)for(const theme of ['light','dark'])for(const count of [1,4])for(const hero of [null,'/assets/brand/forge-banner-800.webp']){
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});
    const items=Array.from({length:count},(_,i)=>({...original,id:'layout-'+i,title:original.title+' '+ 'EvidenceLink'.repeat(20),summary:original.summary+' '+ 'Full summary. '.repeat(25),series_title:original.series_title+' '+ 'LongSeries'.repeat(15),hero_url:hero}));
    await page.route('**/api/home',r=>r.fulfill({json:{...home,featured:items,latest:[]}}));
    await ready(page,'/');await expect(page.locator('.lead-body h2')).toContainText(items[0].title);await layout(page);
    await page.unroute('**/api/home');
  }
});
test('mobile navigation, search, resource filters, map and preserved PDFs',async({page,request})=>{
  await page.setViewportSize({width:320,height:800});await ready(page,'/');
  await page.getByRole('button',{name:'Open menu'}).click();await expect(page.locator('#primaryNav')).toBeVisible();
  await page.locator('#primaryNav').getByRole('link',{name:'Public Records',exact:true}).click();await expect(page).toHaveURL(/\/records$/);await layout(page);
  await expect(page.getByRole('button',{name:'Open menu'})).toHaveAttribute('aria-expanded','false');
  await ready(page,'/resources');await page.getByRole('searchbox',{name:'Filter resources'}).fill('court');
  await expect(page.locator('.results-meta')).toContainText('6 of 26');await layout(page);
  await ready(page,'/map');await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.locator('.leaflet-control-zoom-in').click();await layout(page);
  const {records}=await publicPaths(request);
  for(const d of records.items){const r=await request.get('/api/records/'+d.id+'/file');expect(r.ok()).toBeTruthy();expect(r.headers()['content-type']).toContain('application/pdf');expect((await r.body()).subarray(0,5).toString()).toBe('%PDF-');}
});
test('every imported article preserves source text order, headings and citations',async({page,request})=>{
  const {news}=await publicPaths(request);
  for(const item of news.items){
    const data=await(await request.get('/api/news/'+item.slug)).json();
    await ready(page,'/news/'+item.slug);
    if(data.article.hero_url){
      const img=page.locator('.article-hero img');await img.scrollIntoViewIfNeeded();
      await expect(img).toHaveJSProperty('complete',true);await expect(img).not.toHaveJSProperty('naturalWidth',0);
      if(data.article.hero_is_illustration)await expect(page.locator('.article-hero figcaption')).toContainText('Illustration');
    }
    const source=data.article.body;
    const plain=source.replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^\s)]+\)/g,'$1').replace(/^\s*\d+[.)]\s+/gm,'');
    const words=s=>(s.match(/[\p{L}\p{N}]+/gu)||[]);
    const text=await page.locator('.article-main .prose').evaluate(el=>{
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const parts=[];while(walker.nextNode())parts.push(walker.currentNode.textContent);return parts.join(' ');
    });
    expect(words(text),item.slug).toEqual(words(plain));
    const headings=[...source.matchAll(/^(#{2,4})\s+(.*)$/gm)];
    expect(await page.locator('.article-main .prose :is(h2,h3,h4)').count()).toBe(headings.length);
    expect(await page.locator('.article-sources .source-list > li').count()).toBe(data.citations.length);
    expect(await page.locator('.source-docs .doc-list > li').count()).toBe(data.documents.length);
  }
});
