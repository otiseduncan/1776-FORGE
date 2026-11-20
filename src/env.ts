export interface Env {
  ASSETS: Fetcher;
  /** NEW 1776 FORGE D1 database. Never bind the legacy database here. */
  DB?: D1Database;
  /** NEW 1776 FORGE R2 bucket for original documents and attachments. */
  DOCS?: R2Bucket;
  /** Read-only compatibility access to the independently preserved records Worker. */
  LEGACY_RECORDS?: Fetcher;
  LEGACY_MAP?: Fetcher;
  LEGACY_MAP_ORIGIN?: string;
  APP_ENV?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated Google-verified email addresses granted the owner role at first sign-in. */
  OWNER_EMAILS?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
