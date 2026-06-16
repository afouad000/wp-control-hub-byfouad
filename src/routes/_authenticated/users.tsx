import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users & roles — WP Control Hub" }] }),
  component: UsersPage,
});

function UsersPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Users & permissions" description="Invite team members and assign them to specific sites." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
          <CardDescription>Manage who can see and edit each connected site.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No team members yet"
            description="Invitations and per-site assignments will appear here. Roles: super admin, client, team member."
          />
        </CardContent>
      </Card>
    </div>
  );
}
