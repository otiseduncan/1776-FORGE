import { importedMapRecords } from '../data/imported-map-records.ts';

export interface ImportedMapRecord {
  key: string; id: string; type: string; name: string; county: string; counties: string[]; countyName: string;
  category: string; description: string; status: string; statusTone: string;
  latlng: number[] | null; lines: number[][][]; finance: Record<string, any>;
  sources: Array<Record<string, any>>; [key: string]: any;
}

export const importedId = (r: ImportedMapRecord) => 'legacy-map:' + r.key;
export function importedGeometry(r: ImportedMapRecord) {
  if (r.lines?.length) return { type: r.lines.length === 1 ? 'LineString' : 'MultiLineString', coordinates: r.lines.length === 1 ? r.lines[0].map(c => [c[1], c[0]]) : r.lines.map(l => l.map(c => [c[1], c[0]])) };
  return r.latlng ? { type: 'Point', coordinates: [r.latlng[1], r.latlng[0]] } : null;
}
export function importedFeature(r: ImportedMapRecord) {
  return { type: 'Feature', id: importedId(r), geometry: importedGeometry(r), properties: {
    id: importedId(r), kind: r.type, title: r.name, description: r.description, status: r.status,
    condition_state: 'gray', verification_state: 'unreviewed', origin: 'preserved_map',
    original_key: r.key, county_id: r.county, county_ids: r.counties, jurisdiction_name: r.countyName,
    category: r.category, location_note: r.locationNote, location_precision: r.locationPrecision,
    status_tone: r.statusTone, finance: r.finance, sources: r.sources,
    contractor: r.finance?.details?.find((d: any) => d.label === 'Contractor')?.value?.text || r.original_record?.contractor || null,
    financial_note: r.original_record?.financial || null,
    marker_location: r.latlng, address: r.address || null,
  } };
}
export function importedMatches(r: ImportedMapRecord, q: string) {
  const figures = r.finance?.rows?.flatMap((row: any) => row.figs.map((f: any) => [f.cents, (f.cents / 100).toFixed(2), new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(f.cents / 100), f.what].join(' '))).join(' ') || '';
  const text = [r.name,r.id,r.countyName,r.category,r.description,r.address,r.status,r.original_record?.financial,r.original_record?.contractor,JSON.stringify(r.finance?.details),figures].join(' ').toLowerCase();
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean).every(t => text.includes(t));
}
export function filteredImportedMap(params: URLSearchParams) {
  const kinds = (params.get('kind') || '').split(',').filter(Boolean);
  const county = params.get('county'); const j = params.get('jurisdiction'); const cond = params.get('condition');
  return importedMapRecords.filter(r => (!kinds.length || kinds.includes(r.type)) && (!county || r.counties.includes(county)) &&
    (!j || (j === 'ga-baldwin' && r.counties.includes('13009'))) && (!cond || cond === 'gray') && importedMatches(r, params.get('q') || ''));
}
export function findImportedMap(id: string) { return importedMapRecords.find(r => importedId(r) === id); }
export function importedSearch(q: string) { return importedMapRecords.filter(r => importedMatches(r,q)).map(r => ({id:importedId(r),title:r.name,excerpt:r.description,kind:r.type,jurisdiction:r.countyName})); }
