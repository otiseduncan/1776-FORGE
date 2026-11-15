export const ROLES = ["member", "contributor", "researcher", "editor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export function roleRank(role: string): number {
  return ROLES.indexOf(role as Role);
}

/**
 * Capability → minimum role. Community capabilities and editorial capabilities are distinct so that
 * moderation powers are never implied by publishing powers or by future paid entitlements.
 */
export const CAPABILITIES = {
  "community.post": "member",
  "community.report": "member",
  "map.report": "member",
  "article.draft": "contributor",
  "document.create": "researcher",
  "map.feature.write": "researcher",
  "civic.write": "researcher",
  "legal.write": "researcher",
  "links.write": "researcher",
  "document.verify": "editor",
  "article.publish": "editor",
  "article.correct": "editor",
  "resource.write": "editor",
  "moderate": "editor",
  "jurisdiction.write": "editor",
  "users.manage": "admin",
  "audit.read": "admin",
  "imports.manage": "admin",
} as const satisfies Record<string, Role>;

export type Capability = keyof typeof CAPABILITIES;

export interface SessionUser {
  id: string;
  display_name: string;
  role: Role;
  state: string;
  email: string;
  avatar_url: string | null;
}

export function can(user: Pick<SessionUser, "role" | "state"> | null | undefined, cap: Capability): boolean {
  if (!user || user.state !== "active") return false;
  return roleRank(user.role) >= roleRank(CAPABILITIES[cap]);
}

export function capabilitiesFor(user: Pick<SessionUser, "role" | "state"> | null): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(user, c));
}

/** Rules for an actor changing another account's role. Returns an error message or null. */
export function roleChangeError(actor: SessionUser, target: { id: string; role: string }, newRole: string): string | null {
  if (!ROLES.includes(newRole as Role)) return "Unknown role";
  const a = roleRank(actor.role);
  if (actor.role === "owner") return null;
  if (target.id === actor.id) return "You cannot change your own role";
  if (roleRank(target.role) >= a) return "You cannot change the role of an account at or above your own level";
  if (roleRank(newRole) >= a) return "You cannot grant a role at or above your own level";
  return null;
}
