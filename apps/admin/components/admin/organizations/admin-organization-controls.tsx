"use client";

import * as React from "react";
import { Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@ostiary/core/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@ostiary/core/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@ostiary/core/components/ui/field";
import { Input } from "@ostiary/core/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ostiary/core/components/ui/select";
import {
  addExistingMember,
  cancelInvitation,
  inviteMember,
  removeMember,
  renameOrganization,
  searchMembershipCandidates,
  updateMemberRole,
} from "@/app/[locale]/(console)/organizations/[id]/actions";
import { ConfirmRemoveDialog } from "@/components/admin/common/confirm-remove-dialog";
import { DialogActions } from "@/components/admin/common/dialog-actions";
import { useAdminAction } from "@/components/admin/common/use-admin-action";
import { useDebouncedValue } from "@/components/admin/common/use-debounced-value";

/** A built-in role (translated) or one of the organization's own (shown by its name). */
type Role = string;
const ROLES = ["owner", "admin", "member"] as const;

export function RenameOrganizationForm({ id, name, slug }: { id: string; name: string; slug: string }) {
  const t = useTranslations("admin.pages.organizations.controls");
  const tc = useTranslations("admin.common");
  const [draftName, setDraftName] = React.useState(name);
  const [draftSlug, setDraftSlug] = React.useState(slug);
  const { busy, run } = useAdminAction();
  const dirty = draftName.trim() !== name || draftSlug.trim() !== slug;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => renameOrganization(id, draftName, draftSlug), t("organizationUpdated"));
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="org-name">{tc("name")}</FieldLabel>
          <Input id="org-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={busy} />
        </Field>
        <Field>
          <FieldLabel htmlFor="org-slug">{t("slug")}</FieldLabel>
          <Input id="org-slug" value={draftSlug} onChange={(e) => setDraftSlug(e.target.value)} disabled={busy} autoComplete="off" />
        </Field>
        <div>
          <Button type="submit" size="sm" loading={busy} disabled={!dirty}>
            {tc("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

function OrganizationRoleOptions({ customRoles, current }: { customRoles: readonly string[]; current?: string }) {
  const t = useTranslations("admin.pages.organizations.controls.roles");
  const all = [...ROLES, ...customRoles];
  const roles = current && !all.includes(current) ? [...all, current] : all;
  return roles.map((role) => (
    <SelectItem key={role} value={role}>
      {(ROLES as readonly string[]).includes(role) ? t(role) : role}
    </SelectItem>
  ));
}

export function MemberRoleSelect({ orgId, memberId, role, customRoles = [] }: { orgId: string; memberId: string; role: string; customRoles?: string[] }) {
  const t = useTranslations("admin.pages.organizations.controls");
  const { busy, run } = useAdminAction();
  return (
    <Select
      value={role}
      disabled={busy}
      onValueChange={(next) => void run(() => updateMemberRole(orgId, memberId, next as Role), t("roleUpdated"))}
    >
      <SelectTrigger size="sm" className="w-32" aria-label={t("role")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <OrganizationRoleOptions customRoles={customRoles} current={role} />
      </SelectContent>
    </Select>
  );
}

export function AddExistingMemberDialog({ orgId, customRoles }: { orgId: string; customRoles: string[] }) {
  const t = useTranslations("admin.pages.organizations.controls");
  const tc = useTranslations("admin.common");
  const tu = useTranslations("admin.pages.users.list");
  const te = useTranslations("admin.pages.organizations.errors");
  const searchId = React.useId();
  const roleId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [result, setResult] = React.useState<{ query: string; response: Awaited<ReturnType<typeof searchMembershipCandidates>> | null }>();
  const { busy, run } = useAdminAction();
  const term = search.trim();
  const query = useDebouncedValue(term, 300);
  const current = query === term && result?.query === query ? result : undefined;

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    void searchMembershipCandidates(orgId, query).then(
      (response) => { if (active) setResult({ query, response }); },
      () => { if (active) setResult({ query, response: null }); },
    );
    return () => { active = false; };
  }, [open, orgId, query]);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setSearch("");
      setUserId("");
      setRole("member");
      setResult(undefined);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || busy) return;
    if (await run(() => addExistingMember(orgId, userId, role), t("memberAdded"))) changeOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) changeOpen(next); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <UserPlus aria-hidden />
          {t("addExistingUser")}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("addExistingUser")}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={searchId}>{tu("searchLabel")}</FieldLabel>
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setUserId("");
              }}
              placeholder={tu("searchPlaceholder")}
              maxLength={1000}
              autoComplete="off"
              disabled={busy}
            />
            {!current ? (
              <p className="text-sm text-muted-foreground" role="status">{tc("loading")}</p>
            ) : !current.response?.ok ? (
              <p className="text-sm text-destructive" role="alert">{current.response?.error ?? te("requestFailed")}</p>
            ) : current.response.users.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">{tu("empty")}</p>
            ) : (
              <fieldset aria-label={tu("columns.user")} disabled={busy} className="max-h-52 min-w-0 divide-y overflow-y-auto rounded-md border">
                {current.response.users.map((candidate) => (
                  <label key={candidate.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50 has-checked:bg-muted">
                    <input type="radio" name={searchId} value={candidate.id} checked={userId === candidate.id} onChange={() => setUserId(candidate.id)} />
                    <span className="min-w-0 break-words text-sm">
                      <span className="block font-medium">{candidate.name || candidate.email}</span>
                      {candidate.name ? <span className="block text-muted-foreground">{candidate.email}</span> : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={roleId}>{t("role")}</FieldLabel>
            <Select value={role} onValueChange={setRole} disabled={busy}>
              <SelectTrigger id={roleId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <OrganizationRoleOptions customRoles={customRoles} />
              </SelectContent>
            </Select>
          </Field>
          <DialogActions busy={busy} onCancel={() => changeOpen(false)} confirmLabel={t("addExistingUser")} confirmDisabled={!userId} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Icon button that asks for confirmation, then runs the action. */
function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function confirm() {
    setBusy(true);
    const ok = await onConfirm();
    setBusy(false);
    if (ok) setOpen(false);
  }

  return (
    <>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={() => setOpen(true)}>
        <Trash2 className="size-4" aria-hidden />
      </Button>
      <ConfirmRemoveDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={body}
        pending={busy}
        onConfirm={() => void confirm()}
        confirmLabel={confirmLabel}
      />
    </>
  );
}

export function RemoveMemberButton({ orgId, memberId, email }: { orgId: string; memberId: string; email: string }) {
  const t = useTranslations("admin.pages.organizations.controls");
  const tc = useTranslations("admin.common");
  const { run } = useAdminAction();
  return (
    <ConfirmButton
      label={t("removeMemberLabel", { email })}
      title={t("removeMemberTitle", { email })}
      body={t("removeMemberBody")}
      confirmLabel={tc("remove")}
      onConfirm={() => run(() => removeMember(orgId, memberId), t("memberRemoved"))}
    />
  );
}

export function CancelInvitationButton({ orgId, invitationId, email }: { orgId: string; invitationId: string; email: string }) {
  const t = useTranslations("admin.pages.organizations.controls");
  const { run } = useAdminAction();
  return (
    <ConfirmButton
      label={t("cancelInvitationLabel", { email })}
      title={t("cancelInvitationTitle", { email })}
      body={t("cancelInvitationBody")}
      confirmLabel={t("cancelInvitation")}
      onConfirm={() => run(() => cancelInvitation(orgId, invitationId), t("invitationCancelled"))}
    />
  );
}

export function InviteMemberForm({ orgId, customRoles = [] }: { orgId: string; customRoles?: string[] }) {
  const t = useTranslations("admin.pages.organizations.controls");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("member");
  const { busy, run } = useAdminAction();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => inviteMember(orgId, email, role), t("invitationSent"))) setEmail("");
      }}
    >
      <Field className="flex-1">
        <FieldLabel htmlFor="invite-email">{t("inviteByEmail")}</FieldLabel>
        <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
      </Field>
      <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={busy}>
        <SelectTrigger className="w-full sm:w-32" aria-label={t("role")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <OrganizationRoleOptions customRoles={customRoles} />
        </SelectContent>
      </Select>
      <Button type="submit" loading={busy} disabled={!email.trim()}>
        {t("sendInvitation")}
      </Button>
    </form>
  );
}
