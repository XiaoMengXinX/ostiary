import { asc, ne } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription } from "@ostiary/core/components/ui/alert";
import { db } from "@ostiary/core/db/index";
import { organization } from "@ostiary/core/db/schema";
import { PUBLIC_ORGANIZATION_ID } from "@ostiary/core/lib/organization-public";

import { CloudflareAccessPanel } from "@/components/admin/cloudflare-access/cloudflare-access-panel";
import { PageHeader } from "@/components/admin/common/page-header";
import { accessConfiguration, CloudflareAccessError, cloudflareAccess } from "@/lib/cloudflare-access";
import { requireAdminSession } from "@/lib/require-admin-session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cloudflare Access" };

export default async function CloudflareAccessPage() {
  await requireAdminSession();
  const t = await getTranslations("admin.pages.cloudflareAccess");
  const configuration = accessConfiguration();

  async function load() {
    if (!configuration) return { error: t("notConfigured") } as const;
    try {
      const [applications, organizations] = await Promise.all([
        cloudflareAccess(configuration).applications(),
        db.select({ id: organization.id, name: organization.name, slug: organization.slug })
          .from(organization).where(ne(organization.id, PUBLIC_ORGANIZATION_ID)).orderBy(asc(organization.name)),
      ]);
      return { applications, organizations };
    } catch (error) {
      console.error("Cloudflare Access applications could not be loaded", error instanceof CloudflareAccessError ? error.message : (error as Error)?.name);
      return { error: t("unavailable") } as const;
    }
  }

  const data = await load();
  return (
    <div className="space-y-6">
      <PageHeader title="Cloudflare Access" />
      {"error" in data ? (
        <Alert>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      ) : <CloudflareAccessPanel {...data} />}
    </div>
  );
}
