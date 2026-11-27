import { afterEach, describe, expect, it, vi } from "vitest";

import { accessDestination, cloudflareAccess } from "./cloudflare-access";

const identityProviderId = "529137ca-25cb-456e-8c73-0c6c1465908c";
const organization = { id: "org_ai", slug: "private-ai" };
const secondOrganization = { id: "org_other", slug: "other" };
const appId = "2ac79dda-a893-43a5-89b6-37cc15836764";
const policyId = "4e6fc0e9-089b-4d9f-a49a-ba35a132b681";
const nextPolicyId = "766201dc-aef9-470f-b0d5-ef1c4dd77322";
const target = "app.example.com/admin";

function policy(id: string, org = organization) {
  return {
    id,
    name: `Ostiary ${org.slug}`,
    reusable: true,
    decision: "allow",
    include: [{ oidc: { identity_provider_id: identityProviderId, claim_name: "ostiary_org_ids", claim_value: org.id } }],
    require: [{ login_method: { id: identityProviderId } }],
    exclude: [],
  };
}

const normalizedApp = {
  id: appId,
  name: "Test application",
  type: "self_hosted",
  domain: target,
  destinations: [{ type: "public", uri: target }],
  allowed_idps: [identityProviderId],
  auto_redirect_to_identity: true,
  policies: [policy(policyId)],
};

function mockAccess() {
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", request);
  return {
    request,
    client: cloudflareAccess({ accountId: "a".repeat(32), apiToken: "mock-token", identityProviderId }),
  };
}

function reply(result: unknown, totalPages?: number) {
  return Response.json({ success: true, result, result_info: totalPages === undefined ? undefined : { total_pages: totalPages } });
}

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare Access destinations", () => {
  const reserved = new Set(["auth.example.com"]);

  it("normalizes hostnames and allows a path prefix or the whole host", () => {
    expect(accessDestination("APP.Example.com.", " /dashboard/ ", reserved)).toBe("app.example.com/dashboard");
    expect(accessDestination("app.example.com", "", reserved)).toBe("app.example.com");
    expect(accessDestination("app.example.com", "/dashboard/*", reserved)).toBe("app.example.com/dashboard/*");
  });

  it("rejects identity-provider hosts, embedded URLs and ambiguous paths", () => {
    expect(() => accessDestination("auth.example.com", "/login", reserved)).toThrow("invalidTarget");
    expect(() => accessDestination("https://app.example.com", "", reserved)).toThrow("invalidTarget");
    expect(() => accessDestination("app.example.com", "/admin/../", reserved)).toThrow("invalidTarget");
    expect(() => accessDestination("app.example.com", "/admin?test=1", reserved)).toThrow("invalidTarget");
  });
});

describe("Cloudflare Access application management", () => {
  it("finds the existing organization policy by claim even after it has been renamed", async () => {
    const { request, client } = mockAccess();
    request.mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply([], 2))
      .mockResolvedValueOnce(reply([{ ...policy(policyId), name: "Existing policy name" }], 2))
      .mockResolvedValueOnce(reply(normalizedApp));

    await expect(client.create(normalizedApp.name, target, organization)).resolves.toMatchObject({ id: appId, changed: true });
    expect(request.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("page"))).toEqual(["1", "1", "2", null]);
    const [url, requestOptions] = request.mock.calls[3]!;
    expect(String(url)).toMatch(/\/access\/apps$/);
    expect(requestOptions?.method).toBe("POST");
    expect(JSON.parse(String(requestOptions?.body))).toMatchObject({
      destinations: [{ type: "public", uri: target }],
      allow_authenticate_via_warp: false,
      allowed_idps: [identityProviderId],
      policies: [{ id: policyId, precedence: 1 }],
    });
  });

  it("creates an organization-only shared policy before creating the application", async () => {
    const { request, client } = mockAccess();
    request.mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply(policy(policyId)))
      .mockResolvedValueOnce(reply(normalizedApp));
    await client.create(normalizedApp.name, target, organization);
    const [url, requestOptions] = request.mock.calls[2]!;
    expect(String(url)).toMatch(/\/access\/policies$/);
    expect(requestOptions?.method).toBe("POST");
    expect(JSON.parse(String(requestOptions?.body))).toEqual({
      name: "Ostiary private-ai",
      decision: "allow",
      include: policy(policyId).include,
      require: policy(policyId).require,
      exclude: [],
      session_duration: "24h",
    });
  });

  it("reuses a previous attempt and rejects overlapping paths from other applications", async () => {
    const { request, client } = mockAccess();
    request.mockImplementation(async () => reply([normalizedApp]));
    await expect(client.create(normalizedApp.name, target, organization)).resolves.toMatchObject({ changed: false });
    await expect(client.create(normalizedApp.name, `${target}/settings`, organization)).rejects.toThrow("targetConflict");
    await expect(client.create(normalizedApp.name, target, secondOrganization)).rejects.toThrow("targetConflict");
    expect(request.mock.calls.every(([, opts]) => opts?.method === "GET")).toBe(true);
  });

  it("preserves destinations, public overrides and existing settings when changing organizations", async () => {
    const { request, client } = mockAccess();
    const destinations = [{ type: "public", uri: target, overrides: [{ path_pattern: "/admin/api/*", behavior: "public" }] }];
    const existing = { ...normalizedApp, destinations, session_duration: "4h", eager_redirect_cookie_setting: true };
    const nextPolicy = policy(nextPolicyId, secondOrganization);
    request.mockResolvedValueOnce(reply(existing)).mockResolvedValueOnce(reply([nextPolicy]))
      .mockResolvedValueOnce(reply({ ...existing, policies: [nextPolicy] }));

    await expect(client.reassign(appId, secondOrganization)).resolves.toMatchObject({ organizationId: secondOrganization.id });
    const change = JSON.parse(String(request.mock.calls[2]![1]?.body));
    expect(change).toMatchObject({ destinations, session_duration: "4h", eager_redirect_cookie_setting: true, policies: [{ id: nextPolicyId, precedence: 1 }] });
    expect(change).not.toHaveProperty("id");
  });

  it("refuses to edit a policy that also contains individual email conditions", async () => {
    const { request, client } = mockAccess();
    const existing = policy(policyId);
    request.mockResolvedValueOnce(reply({
      ...normalizedApp,
      policies: [{ ...existing, include: [...existing.include, { email: { email: "owner@example.com" } }] }],
    }));
    await expect(client.reassign(appId, secondOrganization)).rejects.toThrow("unsupportedApp");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
