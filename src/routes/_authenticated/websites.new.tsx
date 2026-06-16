import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { connectWebsite } from "@/lib/websites.functions";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/websites/new")({
  head: () => ({ meta: [{ title: "Connect website — WP Control Hub" }] }),
  component: NewWebsite,
});

function NewWebsite() {
  const fn = useServerFn(connectWebsite);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLoading(true);
    try {
      const res = await fn({
        data: {
          name: String(f.get("name") ?? ""),
          url: String(f.get("url") ?? ""),
          client_name: (f.get("client_name") as string) || null,
          logo_url: (f.get("logo_url") as string) || null,
          wp_username: String(f.get("wp_username") ?? ""),
          wp_app_password: String(f.get("wp_app_password") ?? ""),
          wc_consumer_key: (f.get("wc_consumer_key") as string) || null,
          wc_consumer_secret: (f.get("wc_consumer_secret") as string) || null,
        },
      });
      qc.invalidateQueries({ queryKey: ["websites"] });
      if (res.probe.ok) toast.success("Site connected successfully");
      else toast.warning(`Saved, but probe failed: ${res.probe.error ?? "unknown"}`);
      navigate({ to: "/websites/$id", params: { id: res.website.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/websites"><ArrowLeft className="mr-2 h-4 w-4" /> Back to websites</Link>
      </Button>

      <PageHeader title="Connect a website" description="Add your WordPress site's REST credentials. WooCommerce is optional." />

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site details</CardTitle>
            <CardDescription>How you'll recognize the site in this dashboard.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" name="name" required placeholder="My agency client" />
            <Field label="WordPress URL" name="url" required placeholder="https://example.com" type="url" />
            <Field label="Client name (optional)" name="client_name" placeholder="Acme Inc." />
            <Field label="Logo URL (optional)" name="logo_url" placeholder="https://…/logo.svg" type="url" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">WordPress credentials</CardTitle>
            <CardDescription>
              Create an Application Password under Users → Profile → Application Passwords in WP admin.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="WP username" name="wp_username" required />
            <Field label="Application password" name="wp_app_password" required type="password" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">WooCommerce REST keys (optional)</CardTitle>
            <CardDescription>WooCommerce → Settings → Advanced → REST API. Permissions: Read/Write.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Consumer key" name="wc_consumer_key" placeholder="ck_…" />
            <Field label="Consumer secret" name="wc_consumer_secret" placeholder="cs_…" type="password" />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button asChild type="button" variant="outline"><Link to="/websites">Cancel</Link></Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Connect site
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...rest} />
    </div>
  );
}
