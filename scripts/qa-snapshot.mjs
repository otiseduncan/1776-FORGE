// Read public content only. Keep the snapshot outside Git; never rewrite remote content.
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin = 'https://1776-forge.otiseduncan.workers.dev';
await mkdir('qa-artifacts', { recursive: true });
const get = async p => { const r = await fetch(origin + p); if (!r.ok) throw Error(`${p}: ${r.status}`); return r.json(); };
const news = await get('/api/news?pageSize=100');
const snapshot = { origin, captured: new Date().toISOString(), home: await get('/api/home'), news, articles: [] };
for (const a of news.items) snapshot.articles.push(await get('/api/news/' + a.slug));
snapshot.records = await get('/api/records?pageSize=100');
await writeFile('qa-artifacts/public-snapshot.json', JSON.stringify(snapshot, null, 2));
const hash = x => createHash('sha256').update(x).digest('hex');
const mismatches = [];
for (const dir of ['public/css', 'public/js', 'public/js/core', 'public/js/pages']) {
  for (const f of await readdir(dir)) {
    if (!/\.(css|js)$/.test(f)) continue;
    const path = `${dir}/${f}`;
    const r = await fetch(origin + path.slice(6));
    if (!r.ok || hash((await r.text()).replaceAll('\r\n','\n')) !== hash((await readFile(path,'utf8')).replaceAll('\r\n','\n'))) mismatches.push(path);
  }
}
console.log(JSON.stringify({ titles: snapshot.articles.map(x => ({title:x.article.title, slug:x.article.slug, bodyLength:x.article.body.length, category:x.article.category_name, citations:x.citations.length, documents:x.documents.length})), records: snapshot.records.total, sourceAssetMismatches: mismatches }, null, 2));
