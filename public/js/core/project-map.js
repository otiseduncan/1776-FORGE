import { h } from './dom.js';
import { sourceTextIds } from './map-source-text.js';

const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:cents%100?2:0,maximumFractionDigits:2}).format(cents/100);
export function projectCost(p) {
  const fin=p.finance; const kind=fin?.headline?.kind;
  const fig=fin?.rows?.find(r=>r.key===kind)?.figs?.find(f=>f.cents>0&&!f.partial);
  return fig ? `${fin.headline.label}: ${fig.approx?'about ':''}${money(fig.cents)}` : p.financial_note ? 'See recorded financial note' : 'Cost not recorded';
}
export function projectPreview(p) {
  return h('div.project-map-preview',h('strong',p.title),h('span',p.jurisdiction_name||''),
    p.description?h('p',p.description.length>160?p.description.slice(0,157)+'…':p.description):null,
    h('span',projectCost(p)),p.financial_note&&!p.finance?.headline?.kind?h('small',p.financial_note.length>180?p.financial_note.slice(0,177)+'…':p.financial_note):null,h('span','Contractor: '+(p.contractor||'Not recorded')),
    p.location_precision?h('small',p.location_precision):null);
}
function citation(c) {
  if(!c)return null;
  const page=c.page?` · PDF page ${c.page}`:'';
  if(c.url) return h('a',{href:c.url+(c.page?'#page='+c.page:''),target:'_blank',rel:'noopener noreferrer'},(c.title||'Source')+page);
  if(c.document_id&&sourceTextIds.has(c.document_id))return h('a',{href:'/data/map-source/transcripts/'+encodeURIComponent(c.document_id)+'.json',target:'_blank','data-native':''},'Preserved source text'+page);
  return null;
}
export function importedProjectDetails(ft, record, readSource) {
  return h('div.project-map-detail',h('div.eyebrow',record.type==='road'?'Recorded road inspection':'Recorded public project'),h('h3',record.name),
    h('p.small.muted',record.countyName),h('p',record.description),
    h('dl.meta',h('dt','Recorded status'),h('dd',record.status),record.address?[h('dt','Address / area'),h('dd',record.address)]:null,
      h('dt','Location'),h('dd',record.locationNote||'An exact project location has not been recorded.'),record.locationPrecision?[h('dt','Location precision'),h('dd',record.locationPrecision)]:null),
    h('h3','Costs & funding'),h('p.small.muted','Amounts retain their source labels. Contracts, budgets, invoices and payments are different measures.'),
    ...record.finance.rows.filter(row=>row.figs.length).map(row=>h('section.project-finance-row',h('h4',row.label),...row.figs.map(f=>h('div',
      h('strong',(f.approx?'About ':'')+money(f.cents)),h('p.small',f.what),f.as_of?h('p.small.muted','As of '+f.as_of):null,citation(f.cite))))),
    !record.finance.rows.some(row=>row.figs.length)?h('p','No verified cost figure has been recorded for this project.'):null,
    h('dl.meta',record.finance.details.map(d=>[h('dt',d.label),h('dd',d.value?.text||'Not recorded',d.value?.cite?h('div.small',citation(d.value.cite)):null)])),
    record.finance.notes?h('p.small',record.finance.notes):null,
    record.original_record?.financial&&record.original_record.financial!==record.finance.notes?[h('h4','Original published financial note'),h('p.small',record.original_record.financial)]:null,
    (record.gaps?.length||record.finance.gaps?.length)?h('details',h('summary','Evidence gaps'),h('ul',[...new Set([...(record.gaps||[]),...(record.finance.gaps||[])])].map(g=>h('li',g)))):null,
    h('h3','Sources'),record.sources.length?h('ul.project-source-list',record.sources.map(s=>h('li',
      s.url?h('a',{href:s.url,target:'_blank',rel:'noopener noreferrer'},s.title||'Source record'):h('span',s.title||s.document_id||'Source record'),
      s.transcript&&s.document_id?h('div',h('button.btn-link',{type:'button',onclick:()=>readSource(s.document_id,s.title)},'Read preserved source text')):null,
      s.review?h('p.small.muted',s.review):null))):h('p.small',record.source||'Source reference not recorded.'),
    h('p.small.muted','Imported from the published Baldwin Minute Watch project collection. Historical observations are not a fresh inspection.'));
}
