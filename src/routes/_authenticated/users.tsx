import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, UserPlus, Trash2, Users } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listWebsites, listMembers, inviteMember, updateMember, removeMember,
} from "@/lib/websites.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users & roles — WP Control Hub" }] }),
  component: UsersPage,
});

function UsersPage() {
  const listFn = useServerFn(listWebsites);
  const { data: sites = [] } = useQuery({ queryKey: ["websites"], queryFn: () => listFn() });
  const [siteId, setSiteId] = useState("");
  const active = siteId || sites[0]?.id || "";

  return (
    <div className="space-y-6">
      <PageHeader title="Users & permissions" description="Invite teammates per website and choose what they can do." />
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
          {active ? <MembersCard websiteId={active} /> : null}
        </>
      )}
    </div>
  );
}

function MembersCard({ websiteId }: { websiteId: string }) {
  const fn = useServerFn(listMembers);
  const inv = useServerFn(inviteMember);
  const upd = useServerFn(updateMember);
  const del = useServerFn(removeMember);
  const qc = useQueryClient();

  const [email, setEmail] = useState("");
  const [perm, setPerm] = useState<"view" | "edit" | "owner">("view");
  const [inviting, setInviting] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["members", websiteId],
    queryFn: () => fn({ data: { website_id: websiteId } }),
  });

  const invite = async () => {
    setInviting(true);
    try {
      await inv({ data: { website_id: websiteId, email, permission: perm } });
      toast.success("Member added");
      setEmail("");
      refetch();
      qc.invalidateQueries({ queryKey: ["members", websiteId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const changePerm = async (id: string, p: "view" | "edit" | "owner") => {
    try {
      await upd({ data: { website_id: websiteId, member_id: id, permission: p } });
      toast.success("Updated");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this member?")) return;
    try {
      await del({ data: { website_id: websiteId, member_id: id } });
      toast.success("Removed");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team members</CardTitle>
        <CardDescription>
          Roles: <span className="font-medium">Owner</span> (full access), <span className="font-medium">Edit</span> (manage products/orders), <span className="font-medium">View</span> (read-only).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
          <div className="space-y-1.5">
            <Label className="sr-only">Email</Label>
            <Input placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Select value={perm} onValueChange={(v) => setPerm(v as typeof perm)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="view">View</SelectItem>
              <SelectItem value="edit">Edit</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
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
                <TableHead>Joined</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.full_name || m.email || "Unknown"}</div>
                    {m.email ? <div className="text-xs text-muted-foreground">{m.email}</div> : null}
                  </TableCell>
                  <TableCell>
                    {m.permission === "owner" ? (
                      <Badge>Owner</Badge>
                    ) : (
                      <Select value={m.permission} onValueChange={(v) => changePerm(m.id, v as "view" | "edit" | "owner")}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="view">View</SelectItem>
                          <SelectItem value="edit">Edit</SelectItem>
                          <SelectItem value="owner">Owner</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {m.permission !== "owner" ? (
                      <Button size="sm" variant="ghost" onClick={() => remove(m.id)} className="text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
