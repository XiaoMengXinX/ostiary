"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@ostiary/core/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ostiary/core/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@ostiary/core/components/ui/field";
import { Input } from "@ostiary/core/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ostiary/core/components/ui/select";

import { saveCloudflareApplication } from "@/app/[locale]/(console)/cloudflare-access/actions";
import { useAdminAction } from "@/components/admin/common/use-admin-action";
import { Link } from "@/i18n/navigation";
import type { AccessApplication } from "@/lib/cloudflare-access";

type Organization = { id: string; name: string; slug: string };

function OrganizationPicker({ id, value, onChange, organizations, disabled }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  organizations: Organization[];
  disabled: boolean;
}) {
  const t = useTranslations("admin.pages.cloudflareAccess");
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={t("organization")} />
      </SelectTrigger>
      <SelectContent>
        {organizations.map((org) => <SelectItem key={org.id} value={org.id}>{org.name} ({org.slug})</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ApplicationRow({ application, organizations }: { application: AccessApplication; organizations: Organization[] }) {
  const t = useTranslations("admin.pages.cloudflareAccess");
  const common = useTranslations("admin.common");
  const [selected, setSelected] = useState(application.organizationId);
  const { run, busy } = useAdminAction();
  const id = `cloudflare-org-${application.id}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(() => saveCloudflareApplication({
      operation: "reassign", applicationId: application.id, organizationId: selected,
    }), t("saved"));
  }

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="break-words font-medium">{application.name}</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {application.destinations.map((uri) => <li key={uri} className="break-all font-mono">{uri}</li>)}
        </ul>
      </div>
      <form onSubmit={submit} className="flex w-full min-w-0 items-end gap-2 lg:max-w-sm">
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor={id}>{t("organization")}</FieldLabel>
          <OrganizationPicker id={id} value={selected} onChange={setSelected} organizations={organizations} disabled={busy} />
        </Field>
        <Button type="submit" size="sm" variant="outline" loading={busy} disabled={!selected || selected === application.organizationId}>
          {common("save")}
        </Button>
      </form>
    </li>
  );
}

export function CloudflareAccessPanel({ applications, organizations }: {
  applications: AccessApplication[];
  organizations: Organization[];
}) {
  const t = useTranslations("admin.pages.cloudflareAccess");
  const common = useTranslations("admin.common");
  const nav = useTranslations("admin.nav");
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [path, setPath] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const { run, busy } = useAdminAction();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(() => saveCloudflareApplication({ operation: "create", name, hostname, path, organizationId }), t("saved"))) {
      setName("");
      setHostname("");
      setPath("");
      setOrganizationId("");
    }
  }

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t("create")}</CardTitle>
          <CardDescription>{t("proxyHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="cloudflare-access-name">{common("name")} ({common("optional")})</FieldLabel>
                <Input id="cloudflare-access-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={1000} disabled={busy} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cloudflare-access-hostname">{t("hostname")}</FieldLabel>
                <Input id="cloudflare-access-hostname" value={hostname} onChange={(event) => setHostname(event.target.value)}
                  placeholder="app.example.com" maxLength={254} autoCapitalize="none" spellCheck={false} required disabled={busy} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cloudflare-access-path">{t("path")} ({common("optional")})</FieldLabel>
                <Input id="cloudflare-access-path" value={path} onChange={(event) => setPath(event.target.value)}
                  placeholder="/admin" maxLength={1000} autoCapitalize="none" spellCheck={false} disabled={busy} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cloudflare-access-organization">{t("organization")}</FieldLabel>
                <OrganizationPicker id="cloudflare-access-organization" value={organizationId} onChange={setOrganizationId}
                  organizations={organizations} disabled={busy || organizations.length === 0} />
                {organizations.length === 0 && <Link href="/organizations" className="text-sm underline">{nav("organizations")}</Link>}
              </Field>
            </FieldGroup>
            <Button type="submit" loading={busy} disabled={!hostname.trim() || !organizationId}>{t("create")}</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{nav("applications")}</CardTitle>
        </CardHeader>
        <CardContent>
          {applications.length ? (
            <ul className="divide-y">
              {applications.map((application) => (
                <ApplicationRow key={`${application.id}:${application.organizationId}`} application={application} organizations={organizations} />
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
