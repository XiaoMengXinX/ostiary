import { z } from "zod";

import { PUBLIC_ORGANIZATION_ID } from "@ostiary/core/lib/organization-public";

const organizationClaim = "ostiary_org_ids";
const accountId = z.string().regex(/^[a-f0-9]{32}$/i);
const resourceId = z.uuid();
const readOnlyAppFields = new Set(["id", "uid", "aud", "created_at", "updated_at", "policies"]);

const policySchema = z.object({
  id: resourceId,
  name: z.string(),
  decision: z.string(),
  include: z.array(z.unknown()),
  require: z.array(z.unknown()),
  exclude: z.array(z.unknown()),
  reusable: z.boolean().optional(),
  approval_required: z.boolean().optional(),
  purpose_justification_required: z.boolean().optional(),
  isolation_required: z.boolean().optional(),
  connection_rules: z.record(z.string(), z.unknown()).optional(),
});

const applicationSchema = z.looseObject({
  id: resourceId,
  name: z.string(),
  type: z.string(),
  domain: z.string().optional(),
  self_hosted_domains: z.array(z.string()).optional(),
  allowed_idps: z.array(z.string()).optional(),
  auto_redirect_to_identity: z.boolean().optional(),
  destinations: z.array(z.looseObject({ type: z.string().optional(), uri: z.string().optional() })).optional(),
  policies: z.array(policySchema).optional(),
});

const envelopeSchema = z.object({
  success: z.boolean(),
  result: z.unknown(),
  result_info: z.object({ total_pages: z.number().int().optional() }).optional(),
});

const organizationRule = z.strictObject({
  oidc: z.strictObject({ claim_name: z.literal(organizationClaim), claim_value: z.string().min(1), identity_provider_id: resourceId }),
});
const identityRule = z.strictObject({ login_method: z.strictObject({ id: resourceId }) });

type Policy = z.infer<typeof policySchema>;
type Application = z.infer<typeof applicationSchema>;
type Organization = { id: string; slug: string };

export type AccessApplication = {
  id: string;
  name: string;
  organizationId: string;
  destinations: string[];
};

export type AccessErrorCode = "notConfigured" | "invalidTarget" | "targetConflict" | "policyConflict" | "unsupportedApp" | "unavailable";

export class CloudflareAccessError extends Error {
  constructor(readonly code: AccessErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

export function accessConfiguration() {
  const parsed = z.object({ accountId, identityProviderId: resourceId, apiToken: z.string().trim().min(1) }).safeParse({
    accountId: process.env.CLOUDFLARE_ACCESS_ACCOUNT_ID,
    identityProviderId: process.env.CLOUDFLARE_ACCESS_IDP_ID,
    apiToken: process.env.CLOUDFLARE_ACCESS_API_TOKEN,
  });
  return parsed.success ? parsed.data : null;
}

type Configuration = NonNullable<ReturnType<typeof accessConfiguration>>;

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const pathPattern = /^(?:\/[A-Za-z0-9._~-]+)*(?:\/\*|\/)?$/;

export function accessDestination(hostname: string, path: string, reservedHosts: ReadonlySet<string>): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const pathname = path.trim();
  if (!hostnamePattern.test(host) || reservedHosts.has(host) || !pathPattern.test(pathname)
    || pathname.split("/").some((part) => part === "." || part === "..")) {
    throw new CloudflareAccessError("invalidTarget");
  }
  return host + pathname.replace(/\/$/, "");
}

function splitDestination(uri: string): [string, string] {
  const [host, ...parts] = uri.replace(/^https?:\/\//i, "").split("/");
  return [host!.toLowerCase().replace(/\.$/, ""), parts.join("/").replace(/\/$/, "")];
}

function destinationsOverlap(proposed: string, existing: string): boolean {
  const [host, path] = splitDestination(proposed);
  const [existingHost, existingPath] = splitDestination(existing);
  const hostMatches = existingHost === host
    || (existingHost.includes("*") && new RegExp("^" + existingHost.split("*").map((part) =>
      part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join(".*") + "$").test(host));
  if (!hostMatches) return false;
  const pathPrefix = path.split("*")[0]!.replace(/\/$/, "");
  const existingPrefix = existingPath.split("*")[0]!.replace(/\/$/, "");
  if (existingPath.includes("*") && !existingPath.split("*")[0]!.endsWith("/")) {
    return !pathPrefix || pathPrefix.startsWith(existingPrefix) || existingPrefix.startsWith(pathPrefix);
  }
  return !pathPrefix || !existingPrefix || pathPrefix === existingPrefix
    || pathPrefix.startsWith(existingPrefix + "/") || existingPrefix.startsWith(pathPrefix + "/");
}

function appDestinations(app: Application) {
  return [...new Set([
    ...(app.domain ? [app.domain] : []),
    ...(app.self_hosted_domains ?? []),
    ...(app.destinations ?? []).flatMap(({ uri, type }) => uri && (type === "public" || !type) ? [uri] : []),
  ])];
}

function policyOrganization(policy: Policy, identityProviderId: string): string | undefined {
  if (policy.decision !== "allow" || !policy.reusable || policy.include.length !== 1 || policy.require.length !== 1
    || policy.exclude.length || policy.approval_required || policy.purpose_justification_required
    || policy.isolation_required || Object.keys(policy.connection_rules ?? {}).length) {
    return undefined;
  }
  const membership = organizationRule.safeParse(policy.include[0]);
  const login = identityRule.safeParse(policy.require[0]);
  if (!membership.success || !login.success || membership.data.oidc.identity_provider_id !== identityProviderId
    || login.data.login_method.id !== identityProviderId || membership.data.oidc.claim_value === PUBLIC_ORGANIZATION_ID) {
    return undefined;
  }
  return membership.data.oidc.claim_value;
}

function managedApplication(app: Application, identityProviderId: string): AccessApplication | null {
  if (app.type !== "self_hosted" || !app.auto_redirect_to_identity || app.allowed_idps?.length !== 1
    || app.allowed_idps[0] !== identityProviderId || app.policies?.length !== 1 || !app.destinations?.length
    || app.destinations.some((destination) => (destination.type && destination.type !== "public") || !destination.uri)) {
    return null;
  }
  const organizationId = policyOrganization(app.policies[0]!, identityProviderId);
  return organizationId ? { id: app.id, name: app.name, organizationId, destinations: app.destinations.map(({ uri }) => uri!) } : null;
}

export function cloudflareAccess({ accountId, identityProviderId, apiToken }: Configuration, reservedHosts = new Set<string>()) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/`;

  async function request(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new CloudflareAccessError("unavailable", `Cloudflare API returned HTTP ${response.status}`);
    const envelope = envelopeSchema.safeParse(await response.json());
    if (!envelope.success || !envelope.data.success) throw new CloudflareAccessError("unavailable");
    return envelope.data;
  }

  async function list<Schema extends z.ZodType>(path: string, schema: Schema): Promise<z.output<Schema>[]> {
    const listSchema = z.array(schema);
    const all: z.output<Schema>[] = [];
    const perPage = 100;
    for (let page = 1; ; page++) {
      const response = await request(`${path}?page=${page}&per_page=${perPage}`);
      const results = listSchema.parse(response.result);
      all.push(...results);
      const totalPages = response.result_info?.total_pages;
      if (totalPages === undefined ? results.length < perPage : page >= totalPages) return all;
    }
  }

  async function policyFor(organization: Organization) {
    const policies = await list("policies", policySchema);
    const reusable = policies.find((policy) => policyOrganization(policy, identityProviderId) === organization.id);
    if (reusable) return reusable.id;
    const name = `Ostiary ${organization.slug}`;
    if (policies.some((policy) => policy.name === name)) throw new CloudflareAccessError("policyConflict");
    const { result } = await request("policies", "POST", {
      name,
      decision: "allow",
      include: [{ oidc: { identity_provider_id: identityProviderId, claim_name: organizationClaim, claim_value: organization.id } }],
      require: [{ login_method: { id: identityProviderId } }],
      exclude: [],
      session_duration: "24h",
    });
    const policy = policySchema.parse(result);
    if (policyOrganization(policy, identityProviderId) !== organization.id) throw new CloudflareAccessError("unavailable");
    return policy.id;
  }

  function verifyApplication(result: unknown, organizationId: string) {
    const app = managedApplication(applicationSchema.parse(result), identityProviderId);
    if (app?.organizationId !== organizationId) throw new CloudflareAccessError("unavailable");
    return app;
  }

  return {
    async applications() {
      return (await list("apps", applicationSchema))
        .map((app) => managedApplication(app, identityProviderId))
        .filter((app) => app !== null)
        .sort((first, second) => first.name.localeCompare(second.name));
    },
    async create(name: string, uri: string, organization: Organization) {
      const apps = await list("apps", applicationSchema);
      const overlapping = apps.filter((app) => appDestinations(app).some((existing) => destinationsOverlap(uri, existing)));
      if (overlapping.length) {
        const existing = overlapping.length === 1 && managedApplication(overlapping[0]!, identityProviderId);
        if (existing && existing.name === name && existing.organizationId === organization.id && existing.destinations.length === 1
          && existing.destinations[0] === uri) return { ...existing, changed: false };
        throw new CloudflareAccessError("targetConflict");
      }
      const policy = await policyFor(organization);
      const { result } = await request("apps", "POST", {
        name,
        type: "self_hosted",
        domain: uri,
        destinations: [{ type: "public", uri }],
        allowed_idps: [identityProviderId],
        auto_redirect_to_identity: true,
        allow_authenticate_via_warp: false,
        policies: [{ id: policy, precedence: 1 }],
      });
      return { ...verifyApplication(result, organization.id), changed: true };
    },
    async reassign(id: string, organization: Organization) {
      const endpoint = `apps/${encodeURIComponent(id)}`;
      const { result } = await request(endpoint);
      const app = applicationSchema.parse(result);
      const managed = managedApplication(app, identityProviderId);
      if (!managed || managed.destinations.some((uri) => reservedHosts.has(splitDestination(uri)[0]))) {
        throw new CloudflareAccessError("unsupportedApp");
      }
      if (managed.organizationId === organization.id) return { id, name: managed.name, changed: false };
      const policy = await policyFor(organization);
      const settings = Object.fromEntries(Object.entries(app).filter(([key]) => !readOnlyAppFields.has(key)));
      const { result: updated } = await request(endpoint, "PUT", { ...settings, policies: [{ id: policy, precedence: 1 }] });
      return { ...verifyApplication(updated, organization.id), changed: true };
    },
  };
}
