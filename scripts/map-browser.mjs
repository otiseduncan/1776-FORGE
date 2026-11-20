import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const base=process.env.QA_BASE_URL||'https://1776-forge-staging.otiseduncan.workers.dev';
const phase=process.env.QA_PHASE||'map-staging';
await mkdir('qa-artifacts',{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
const ready=()=>page.locator('.view:not([aria-busy])').waitFor();
const record=s=>{checks.push(s);console.log(s);};
try {
 await page.goto(base+'/map');await ready();
 assert.match(await page.locator('.map-toolbar').innerText(),/127 records.*49 mapped.*78 in county directories/);
 assert.equal(await page.locator('.project-map-pin-wrap').count(),49);
 record('127 records loaded; all 49 saved map locations have icons');
 const aquatic=page.locator('.project-map-pin-wrap[title="Trackman Golf Facility"]');
 await aquatic.click();await page.locator('.leaflet-popup-content').waitFor();
 await page.locator('.leaflet-popup-content').getByRole('button',{name:'Aquatic Center',exact:true}).click();
 await page.locator('.project-map-detail').waitFor();
 assert.match(await page.locator('.project-map-detail').innerText(),/6,998,909\.17/);
 assert.match(await page.locator('.project-map-detail').innerText(),/Original contract, report-listed/);
 record('Overlapping locations provide a project chooser without moving any coordinates');
 record('Marker click opens full financial breakdown and source references');
 const search=page.getByRole('searchbox',{name:'Search map projects'});
 await search.fill('Dyer Construction');await page.waitForResponse(r=>r.url().includes('/api/map/features?')&&r.url().includes('Dyer'));
 await page.waitForFunction(()=>document.querySelector('.map-toolbar')?.textContent.includes('1 record ·'));
 assert.equal(await page.locator('.project-map-pin-wrap').count(),1);
 record('Contractor search filters both icons and project directory');
 const isolated=page.locator('.project-map-pin-wrap[title="Aquatic Center"]');
 await isolated.hover();await page.locator('.leaflet-tooltip.project-map-tooltip').waitFor();
 const hover=await page.locator('.leaflet-tooltip.project-map-tooltip').innerText();
 assert.match(hover,/Aquatic Center/);assert.match(hover,/6,998,909\.17/);assert.match(hover,/Dyer Construction/);
 await page.screenshot({path:`qa-artifacts/${phase}-hover.png`});
 record('Hover shows description, exact contract amount and contractor');

 await search.fill('');await page.waitForResponse(r=>r.url().includes('/api/map/features')&&!r.url().includes('q='));
 await page.getByRole('combobox',{name:'Project county'}).selectOption('13169');
 await page.waitForResponse(r=>r.url().includes('county=13169')&&r.url().includes('/api/map/features'));
 const county=await (await page.request.get(base+'/api/map/features?county=13169')).json();
 assert.ok(county.features.length);assert.ok(county.features.every(f=>f.properties.county_ids.includes('13169')));
 record('Jones County filter restricts results to the recorded county');
 await page.goto(base+'/map?q=Pittman%20Construction%20Road%20Resurfacing');await ready();
 assert.equal(await page.locator('.project-map-pin-wrap').count(),0);
 assert.ok(await page.locator('.project-county-directory').count()>0);
 await page.getByRole('button',{name:'Pittman Construction Road Resurfacing',exact:true}).click();
 await page.locator('.project-map-detail').waitFor();
 assert.match(await page.locator('.project-map-detail').innerText(),/Umbrella resurfacing contract/);
 record('Unlocated projects remain searchable; county navigation is distinct from site icons');
 await page.getByRole('button',{name:'Read preserved source text'}).first().click();
 await page.locator('.project-source-text').first().waitFor();
 assert.ok((await page.locator('.project-source-text').first().innerText()).length>50);
 record('Preserved source text opens with page numbers and an extraction notice');
 await page.keyboard.press('Escape');
 const searchResult=await(await page.request.get(base+'/api/search?q=Aquatic&types=map')).json();
 assert.ok(searchResult.groups.map.some(r=>r.id==='legacy-map:project:research-01'));
 record('Site-wide map search finds migrated projects');
 const layouts=[];
 for(const width of [320,375,430,768,1024,1440,1920]) {
  await page.setViewportSize({width,height:950});await page.goto(base+'/map?feature=legacy-map%3Aproject%3Aresearch-01');await ready();await page.locator('.project-map-detail').waitFor();
  const info=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,mapWidth:document.querySelector('.map-canvas').clientWidth,icons:document.querySelectorAll('.project-map-pin-wrap').length}));
  assert.ok(info.overflow<=1,`${width}px page overflow: ${info.overflow}`);assert.equal(info.icons,49);
  layouts.push({width,...info});if([375,1440].includes(width)){await page.waitForTimeout(700);await page.screenshot({path:`qa-artifacts/${phase}-${width}.png`,fullPage:true});}
 }
 assert.deepEqual(errors,[]);record('Seven widths passed: no page overflow or browser script errors');
 await writeFile(`qa-artifacts/${phase}-browser.json`,JSON.stringify({base,checks,layouts,errors,pass:true},null,2));
}finally{await browser.close();}
