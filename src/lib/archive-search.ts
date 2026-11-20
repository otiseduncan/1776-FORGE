import type { Env } from '../env.ts';

type ArchiveRow = { id: string; title: string; document_date?: string; publisher?: string; notes?: string; classification?: string };
const scopes = new WeakMap<Fetcher, { until: number; ids: string[] }>();

/** Search published catalogue metadata only; original-file publication rules stay upstream. */
export async function searchArchive(env: Env, q: string, limit: number) {
  const service = env.LEGACY_RECORDS;
  if (!service) return { items: [], total: 0, available: false };
  const read = async (params: URLSearchParams) => {
    const response = await service.fetch(new Request('https://baldwin-minute-watch-v21.otiseduncan.workers.dev/api/public-records?' + params,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }));
    if (!response.ok) throw new Error('Archive unavailable');
    return await response.json() as { items: ArchiveRow[]; total: number; entities?: { jurisdiction_id: string }[]; jurisdiction_scope?: string[] };
  };
  try {
    let scope = scopes.get(service);
    if (!scope || scope.until < Date.now()) {
      const probe = await read(new URLSearchParams({ limit: '1' }));
      const ids = [...new Set([...(probe.jurisdiction_scope || []), ...(probe.entities || []).map(e => e.jurisdiction_id)])].filter(Boolean);
      if (!ids.length || ids.length > 20) throw new Error('Archive scope unavailable');
      scope = { ids, until: Date.now() + 300000 }; scopes.set(service, scope);
    }
    const data = await read(new URLSearchParams({ q, limit: String(limit), jurisdictions: scope.ids.join(',') }));
    return { items: data.items.map(r => ({ id: r.id, title: r.title, date: r.document_date, jurisdiction: r.publisher, excerpt: r.notes, classification: r.classification })), total: data.total, available: true };
  } catch {
    return { items: [], total: 0, available: false };
  }
}
