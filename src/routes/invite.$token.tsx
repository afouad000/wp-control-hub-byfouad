import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, MailCheck, ShieldAlert, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getInvitationByToken, acceptInvitation } from "@/lib/invitations.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Team invitation — WP Control Hub" },
      { name: "description", content: "Accept your WP Control Hub team invitation." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setSessionEmail(data.user?.email?.toLowerCase() ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionEmail(session?.user?.email?.toLowerCase() ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const lookup = useServerFn(getInvitationByToken);
  const accept = useServerFn(acceptInvitation);

  const query = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => lookup({ data: { token } }),
    staleTime: 30_000,
  });

  const [accepting, setAccepting] = useState(false);
  const onAccept = async () => {
    setAccepting(true);
    try {
      const res = await accept({ data: { token } });
      if (!res.ok) throw new Error(res.error);
      toast.success("You've joined the team.");
      navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept invitation.");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">Team invitation</CardTitle>
          <CardDescription>You've been invited to join a website in WP Control Hub.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading invitation…
            </div>
          ) : !query.data || !query.data.ok ? (
            <InviteError message={query.data && !query.data.ok ? query.data.error : "Invitation not found."} />
          ) : (
            <InviteBody
              invitation={query.data.invitation}
              token={token}
              sessionEmail={sessionEmail}
              accepting={accepting}
              onAccept={onAccept}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InviteError({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
        <span>{message}</span>
      </div>
      <Button asChild variant="outline" className="w-full"><Link to="/">Go home</Link></Button>
    </div>
  );
}

function InviteBody({
  invitation, token, sessionEmail, accepting, onAccept,
}: {
  invitation: {
    website_name: string; email: string; role: string;
    invited_by_email: string | null; expires_at: string;
    accepted_at: string | null; revoked_at: string | null;
  };
  token: string;
  sessionEmail: string | null | undefined;
  accepting: boolean;
  onAccept: () => void;
}) {
  const expired = new Date(invitation.expires_at).getTime() < Date.now();
  const inactive = invitation.accepted_at || invitation.revoked_at || expired;

  if (invitation.accepted_at) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
          <span>This invitation has already been accepted.</span>
        </div>
        <Button asChild className="w-full"><Link to="/dashboard">Go to dashboard</Link></Button>
      </div>
    );
  }
  if (invitation.revoked_at) return <InviteError message="This invitation was revoked." />;
  if (expired) return <InviteError message="This invitation has expired. Ask for a new one." />;

  const emailMatches = sessionEmail && sessionEmail === invitation.email.toLowerCase();

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 text-sm">
        <div className="text-muted-foreground">Website</div>
        <div className="font-medium">{invitation.website_name}</div>
        <div className="mt-2 text-muted-foreground">Invited email</div>
        <div className="font-medium">{invitation.email}</div>
        <div className="mt-2 text-muted-foreground">Role</div>
        <div className="font-medium capitalize">{invitation.role}</div>
        {invitation.invited_by_email ? (
          <>
            <div className="mt-2 text-muted-foreground">From</div>
            <div className="font-medium">{invitation.invited_by_email}</div>
          </>
        ) : null}
      </div>

      {sessionEmail === undefined ? (
        <div className="text-sm text-muted-foreground">Checking session…</div>
      ) : !sessionEmail ? (
        <Button asChild className="w-full">
          <Link to="/auth" search={{ next: `/invite/${token}` }}>
            <MailCheck className="mr-2 h-4 w-4" /> Sign in as {invitation.email}
          </Link>
        </Button>
      ) : !emailMatches ? (
        <div className="space-y-2">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            You're signed in as <span className="font-medium">{sessionEmail}</span>, but this
            invitation was sent to <span className="font-medium">{invitation.email}</span>.
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await supabase.auth.signOut();
            }}
          >
            Sign out and use the right account
          </Button>
        </div>
      ) : (
        <Button className="w-full" onClick={onAccept} disabled={accepting || Boolean(inactive)}>
          {accepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Accept invitation
        </Button>
      )}
    </div>
  );
}
