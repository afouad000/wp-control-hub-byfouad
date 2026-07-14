import { RequirePermission } from "@/components/require-permission";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Loader2, UserPlus, Trash2, Users, Settings2, Copy, XCircle, Mail } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listWebsites, listMembers, inviteMember, updateMember, removeMember,
} from "@/lib/websites.functions";
import {
  listInvitations, createInvitation, revokeInvitation,
} from "@/lib/invitations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users & roles — WP Control Hub" }] }),
  component: () => (<RequirePermission permission="manage_team"><UsersPage /></RequirePermission>),
});

type RolePreset = "admin" | "editor" | "viewer" | "owner";

const PERMISSION_GROUPS: { title: string; keys: { key: string; label: string }[] }[] = [
  { title: "Overview", keys: [
    { key: "view_dashboard", label: "View dashboard" },
    { key: "view_reports", label: "View reports" },
    { key: "view_activity_logs", label: "View activity logs" },
  ] },
  { title: "Orders", keys: [
    { key: "view_orders", label: "View orders" },
    { key: "edit_orders", label: "Manage orders (status, notes, refunds)" },
  ] },
  { title: "Products", keys: [
    { key: "view_products", label: "View products" },
    { key: "edit_products", label: "Create / edit / delete products" },
  ] },
  { title: "Customers", keys: [
    { key: "view_customers", label: "View customers" },
    { key: "edit_customers", label: "Edit customers" },
  ] },
  { title: "Coupons", keys: [
    { key: "view_coupons", label: "View coupons" },
    { key: "manage_coupons", label: "Create / edit coupons" },
  ] },
  { title: "Admin", keys: [
    { key: "manage_website_settings", label: "Website settings & reconnect" },
    { key: "manage_team", label: "Invite / manage team" },
  ] },
];

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer",
};

function UsersPage() {
  const listFn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => listFn() });
  const [siteId, setSiteId] = useState("");
  const active = siteId || sites[0]?.id || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Users & permissions" description="Invite teammates per website with fine-grained module permissions." />
      {sites.length === 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Team</CardTitle><CardDescription>Connect a website to start inviting members.</CardDescription></CardHeader>
          <CardContent><EmptyState icon={<Users className="h-6 w-6" />} title="No websites yet" /></CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {sites.map((s) => (
              <Button key={s.id} size="sm" variant={active === s.id ? "default" : "outline"} onClick={() => setSiteId(s.id)}>
                {s.name}
              </Button>
            ))}
          </div>
          {active ? (
            <Tabs defaultValue="members" className="w-full">
              <TabsList>
                <TabsTrigger value="members">Members</TabsTrigger>
                <TabsTrigger value="invitations">Invitations</TabsTrigger>
              </TabsList>
              <TabsContent value="members" className="mt-4">
                <MembersCard websiteId={active} />
              </TabsContent>
              <TabsContent value="invitations" className="mt-4">
                <InvitationsCard websiteId={active} />
              </TabsContent>
            </Tabs>
          ) : null}
        </>
      )}
    </div>
  );
}

type Member = {
  id: string; user_id: string; permission: string; role: string | null;
  permissions: Record<string, boolean> | null;
  invitation_status: string | null;
  created_at: string; email: string | null; full_name: string | null;
};

function MembersCard({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(listMembers);
  const inv = useServerFn(inviteMember);
  const upd = useServerFn(updateMember);
  const del = useServerFn(removeMember);
  const qc = useQueryClient();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<RolePreset, "owner">>("viewer");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["members", websiteId],
    queryFn: () => fn({ data: { website_id: websiteId } }),
  });

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["members", websiteId] }); };

  const invite = async () => {
    setInviting(true);
    try {
      await inv({ data: { website_id: websiteId, email, role } });
      toast.success("Member added");
      setEmail("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (m: Member, r: RolePreset) => {
    try {
      await upd({ data: { website_id: websiteId, member_id: m.id, role: r } });
      toast.success("Role updated");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this member?")) return;
    try {
      await del({ data: { website_id: websiteId, member_id: id } });
      toast.success("Removed");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team members</CardTitle>
          <CardDescription>
            Role presets set sensible defaults. Use <span className="font-medium">Customize</span> to fine-tune module permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
            <div className="space-y-1.5">
              <Label className="sr-only">Email</Label>
              <Input placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={invite} disabled={inviting || !email}>
              {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Invite
            </Button>
          </div>

          {isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : !data?.ok ? (
            <p className="text-sm text-destructive">{data?.error ?? "Failed to load"}</p>
          ) : data.members.length === 0 ? (
            <EmptyState title="No members yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Modules</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((m) => {
                  const r = (m.role || m.permission || "viewer") as RolePreset;
                  const isOwner = r === "owner";
                  const grantedCount = m.permissions ? Object.values(m.permissions).filter(Boolean).length : 0;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="font-medium">{m.full_name || m.email || "Unknown"}</div>
                        {m.email ? <div className="text-xs text-muted-foreground">{m.email}</div> : null}
                      </TableCell>
                      <TableCell>
                        {isOwner ? (
                          <Badge>Owner</Badge>
                        ) : (
                          <Select value={r} onValueChange={(v) => changeRole(m as Member, v as RolePreset)}>
                            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer">Viewer</SelectItem>
                              <SelectItem value="editor">Editor</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {isOwner ? "All" : `${grantedCount} enabled`}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {!isOwner ? (
                            <Button size="sm" variant="ghost" onClick={() => setEditing(m as Member)} title="Customize permissions">
                              <Settings2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          {!isOwner ? (
                            <Button size="sm" variant="ghost" onClick={() => remove(m.id)} className="text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <PermissionsDialog
          websiteId={websiteId}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      ) : null}
    </>
  );
}

function PermissionsDialog({
  websiteId, member, onClose, onSaved,
}: { websiteId: string; member: Member; onClose: () => void; onSaved: () => void }) {
  const upd = useServerFn(updateMember);
  const initial = useMemo<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = {};
    for (const g of PERMISSION_GROUPS) for (const k of g.keys) base[k.key] = false;
    return { ...base, ...(member.permissions ?? {}) };
  }, [member]);
  const [perms, setPerms] = useState<Record<string, boolean>>(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await upd({ data: { website_id: websiteId, member_id: member.id, permissions: perms } });
      toast.success("Permissions updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Customize permissions</DialogTitle>
          <DialogDescription>
            {member.full_name || member.email} · Role: {ROLE_LABEL[member.role || member.permission] ?? "Member"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2 max-h-[60vh] overflow-y-auto pr-1">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.title} className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</div>
              <div className="space-y-2 rounded-md border p-3">
                {g.keys.map((k) => (
                  <label key={k.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={!!perms[k.key]}
                      onCheckedChange={(v) => setPerms((p) => ({ ...p, [k.key]: v === true }))}
                    />
                    <span>{k.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvitationsCard({ websiteId }: { websiteId: string }) {
  const listFn = useServerFn(listInvitations);
  const createFn = useServerFn(createInvitation);
  const revokeFn = useServerFn(revokeInvitation);
  const qc = useQueryClient();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("viewer");
  const [creating, setCreating] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["invitations", websiteId],
    queryFn: () => listFn({ data: { website_id: websiteId } }),
  });

  const refresh = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["invitations", websiteId] });
  };

  const create = async () => {
    if (!email) return;
    setCreating(true);
    try {
      const res = await createFn({ data: { website_id: websiteId, email, role } });
      const link = `${window.location.origin}/invite/${res.token}`;
      setLastLink(link);
      try { await navigator.clipboard.writeText(link); } catch { /* clipboard blocked */ }
      toast.success("Invitation created. Link copied to clipboard.");
      setEmail("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create invitation");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this invitation? The link will stop working.")) return;
    try {
      await revokeFn({ data: { id } });
      toast.success("Invitation revoked");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const copyLink = async (token: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const now = Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending invitations</CardTitle>
        <CardDescription>
          Send a link to a teammate. They accept after signing in with the invited email.
          Email delivery isn't wired yet — copy and share the link manually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
          <Input
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={create} disabled={creating || !email}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Create invite
          </Button>
        </div>

        {lastLink ? (
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <div className="mb-1 font-medium text-foreground">Invitation link</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-background px-2 py-1">{lastLink}</code>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(lastLink)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : !data?.ok ? (
          <p className="text-sm text-destructive">Failed to load invitations.</p>
        ) : data.invitations.length === 0 ? (
          <EmptyState title="No pending invitations" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invitations.map((i) => {
                const expired = new Date(i.expires_at).getTime() < now;
                const status = i.accepted_at
                  ? "Accepted"
                  : i.revoked_at
                  ? "Revoked"
                  : expired
                  ? "Expired"
                  : "Pending";
                const isPending = status === "Pending";
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.email}</TableCell>
                    <TableCell className="capitalize">{i.role}</TableCell>
                    <TableCell>
                      <Badge variant={isPending ? "default" : "outline"}>{status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(i.expires_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {isPending ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => copyLink((i as unknown as { token?: string }).token ?? "")} title="Copy link" disabled>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => revoke(i.id)} className="text-destructive" title="Revoke">
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
