"use server";

import { eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@ostiary/core/db/index";
import { organization } from "@ostiary/core/db/schema";
import { env } from "@ostiary/core/lib/env";
import { PUBLIC_ORGANIZATION_ID } from "@ostiary/core/lib/organization-public";

import { adminAction, input } from "@/lib/admin-action";
import type { ActionResult } from "@/lib/action-result";
import { accessConfiguration, accessDestination, CloudflareAccessError, cloudflareAccess } from "@/lib/cloudflare-access";

const formInput = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    name: input.text.transform((name) => name.trim()),
    hostname: z.string().trim().max(254).min(1),
    path: input.text,
    organizationId: input.id,
  }),
  z.object({ operation: z.literal("reassign"), applicationId: z.uuid(), organizationId: input.id }),
]);

export async function saveCloudflareApplication(form: z.input<typeof formInput>): Promise<ActionResult> {
  return adminAction(formInput, form, async (data, { audit }) => {
    const t = await getTranslations("admin.pages.cloudflareAccess");
    const configuration = accessConfiguration();
    if (!configuration) return { ok: false, error: t("notConfigured") };
    if (data.organizationId === PUBLIC_ORGANIZATION_ID) return { ok: false, error: t("organizationRequired") };

    const reservedHosts = new Set([env.AUTH_APP_URL, env.BETTER_AUTH_URL, env.ADMIN_APP_URL, env.NEXT_PUBLIC_APP_URL]
      .filter((url): url is string => !!url)
      .map((url) => new URL(url).hostname));
    const access = cloudflareAccess(configuration, reservedHosts);
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`cloudflare-access:${configuration.accountId}`}, 0))`);
        const [selected] = await tx
          .select({ id: organization.id, slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, data.organizationId))
          .for("share");
        if (!selected) return null;
        if (data.operation === "reassign") return access.reassign(data.applicationId, selected);

        const uri = accessDestination(data.hostname, data.path, reservedHosts);
        return access.create(data.name || uri, uri, selected);
      });
      if (!result) return { ok: false, error: t("organizationRequired") };
      if (result.changed) {
        await audit({
          action: data.operation === "create" ? "cloudflare_access.create" : "cloudflare_access.reassign",
          target: { type: "cloudflare_access", id: result.id, label: result.name },
          metadata: { organizationId: data.organizationId },
        });
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof CloudflareAccessError && error.code !== "unavailable") return { ok: false, error: t(error.code) };
      console.error("Cloudflare Access application save failed", error instanceof CloudflareAccessError ? error.message : (error as Error)?.name);
      return { ok: false, error: t("unavailable") };
    }
  });
}
