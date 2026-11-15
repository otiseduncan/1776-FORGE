import { HttpError } from "./http.ts";

type Body = Record<string, unknown>;

export interface StrOpts { required?: boolean; max?: number; min?: number; trim?: boolean }

export function str(body: Body, key: string, opts: StrOpts = {}): string | null {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") {
    if (opts.required) throw new HttpError(422, `${key} is required`, { field: key });
    return null;
  }
  if (typeof raw !== "string") throw new HttpError(422, `${key} must be text`, { field: key });
  const value = opts.trim === false ? raw : raw.trim();
  if (!value) {
    if (opts.required) throw new HttpError(422, `${key} is required`, { field: key });
    return null;
  }
  if (opts.min && value.length < opts.min) throw new HttpError(422, `${key} must be at least ${opts.min} characters`, { field: key });
  if (value.length > (opts.max ?? 500)) throw new HttpError(422, `${key} must be at most ${opts.max ?? 500} characters`, { field: key });
  return value;
}

export function reqStr(body: Body, key: string, opts: Omit<StrOpts, "required"> = {}): string {
  return str(body, key, { ...opts, required: true }) as string;
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], opts: { required?: boolean; fallback?: T } = {}): T | null {
  const value = str(body, key, { required: opts.required, max: 64 });
  if (value === null) return opts.fallback ?? null;
  if (!(allowed as readonly string[]).includes(value)) throw new HttpError(422, `${key} must be one of: ${allowed.join(", ")}`, { field: key });
  return value as T;
}

export function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function httpsUrl(body: Body, key: string, opts: { required?: boolean } = {}): string | null {
  const value = str(body, key, { required: opts.required, max: 2000 });
  if (value === null) return null;
  if (!isHttpsUrl(value)) throw new HttpError(422, `${key} must be a valid https:// URL`, { field: key });
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isoDate(body: Body, key: string, opts: { required?: boolean } = {}): string | null {
  const value = str(body, key, { required: opts.required, max: 10 });
  if (value === null) return null;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) throw new HttpError(422, `${key} must be a date in YYYY-MM-DD format`, { field: key });
  return value;
}

export function int(body: Body, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") {
    if (opts.required) throw new HttpError(422, `${key} is required`, { field: key });
    return null;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n)) throw new HttpError(422, `${key} must be a whole number`, { field: key });
  if (opts.min !== undefined && n < opts.min) throw new HttpError(422, `${key} must be ≥ ${opts.min}`, { field: key });
  if (opts.max !== undefined && n > opts.max) throw new HttpError(422, `${key} must be ≤ ${opts.max}`, { field: key });
  return n;
}

export function num(body: Body, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") {
    if (opts.required) throw new HttpError(422, `${key} is required`, { field: key });
    return null;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(422, `${key} must be a number`, { field: key });
  if (opts.min !== undefined && n < opts.min) throw new HttpError(422, `${key} must be ≥ ${opts.min}`, { field: key });
  if (opts.max !== undefined && n > opts.max) throw new HttpError(422, `${key} must be ≤ ${opts.max}`, { field: key });
  return n;
}

export function bool(body: Body, key: string): boolean | null {
  const raw = body[key];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "boolean") throw new HttpError(422, `${key} must be true or false`, { field: key });
  return raw;
}

export function stringList(body: Body, key: string, opts: { maxItems?: number; maxLen?: number } = {}): string[] {
  const raw = body[key];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(422, `${key} must be a list`, { field: key });
  if (raw.length > (opts.maxItems ?? 20)) throw new HttpError(422, `${key} has too many items`, { field: key });
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") throw new HttpError(422, `${key} must contain text`, { field: key });
    const v = item.trim();
    if (!v) continue;
    if (v.length > (opts.maxLen ?? 60)) throw new HttpError(422, `${key} entries are too long`, { field: key });
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

export function likePattern(q: string): string {
  return "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
}

export function cleanQuery(url: URL, key = "q", max = 120): string {
  return (url.searchParams.get(key) || "").trim().slice(0, max);
}

const GEOMETRY_TYPES = ["Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"];

function validPosition(p: unknown): boolean {
  return Array.isArray(p) && p.length >= 2 && p.length <= 3 && p.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (p[0] as number) >= -180 && (p[0] as number) <= 180 && (p[1] as number) >= -90 && (p[1] as number) <= 90;
}

function validCoords(type: string, c: unknown): boolean {
  const arr = (x: unknown): x is unknown[] => Array.isArray(x);
  switch (type) {
    case "Point": return validPosition(c);
    case "MultiPoint": return arr(c) && c.length > 0 && c.every(validPosition);
    case "LineString": return arr(c) && c.length >= 2 && c.every(validPosition);
    case "MultiLineString": return arr(c) && c.length > 0 && c.every((l) => validCoords("LineString", l));
    case "Polygon": return arr(c) && c.length > 0 && c.every((r) => arr(r) && r.length >= 4 && r.every(validPosition));
    case "MultiPolygon": return arr(c) && c.length > 0 && c.every((p) => validCoords("Polygon", p));
    default: return false;
  }
}

export function geometry(body: Body, key = "geometry"): string {
  const g = body[key] as { type?: unknown; coordinates?: unknown } | undefined;
  if (!g || typeof g !== "object") throw new HttpError(422, `${key} is required (GeoJSON geometry)`, { field: key });
  if (typeof g.type !== "string" || !GEOMETRY_TYPES.includes(g.type)) throw new HttpError(422, `${key}.type must be one of ${GEOMETRY_TYPES.join(", ")}`, { field: key });
  if (!validCoords(g.type, g.coordinates)) throw new HttpError(422, `${key}.coordinates are not valid WGS84 coordinates for ${g.type}`, { field: key });
  const out = JSON.stringify({ type: g.type, coordinates: g.coordinates });
  if (out.length > 400_000) throw new HttpError(413, "Geometry is too large");
  return out;
}

const VIDEO_HOSTS = ["www.youtube.com", "youtube.com", "youtu.be", "vimeo.com", "player.vimeo.com", "archive.org", "www.c-span.org"];
export function videoUrl(body: Body, key = "video_url"): string | null {
  const value = httpsUrl(body, key);
  if (!value) return null;
  if (!VIDEO_HOSTS.includes(new URL(value).hostname)) throw new HttpError(422, `${key} must be a YouTube, Vimeo, Internet Archive or C-SPAN link`, { field: key });
  return value;
}
