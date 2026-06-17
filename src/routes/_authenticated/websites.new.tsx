import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { testConnection, connectWebsite } from "@/lib/websites.functions";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/websites/new")({
  head: () => ({ meta: [{ title: "Connect website — WP Control Hub" }] }),
  component: NewWebsite,
});

type Form = {
  name: string; url: string; client_name: string; logo_url: string;
  wp_username: string; wp_app_password: string;
  wc_consumer_key: string; wc_consumer_secret: string;
};

type ProbeResult = Awaited<ReturnType<typeof testConnection>>;

const STEPS = ["Site details", "Credentials", "Test & confirm"] as const;

function NewWebsite() {
  const test = useServerFn(testConnection);
  const connect = useServerFn(connectWebsite);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>({
    name: "", url: "", client_name: "", logo_url: "",
    wp_username: "", wp_app_password: "",
    wc_consumer_key: "", wc_consumer_secret: "",
  });
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const canNext0 = form.name.trim() && /^https?:\/\//.test(form.url);
  const canNext1 = form.wp_username.trim() && form.wp_app_password.trim();

  const runTest = async () => {
    setTesting(true);
    setProbe(null);
    try {
      const result = await test({
        data: {
          url: form.url,
          wp_username: form.wp_username,
          wp_app_password: form.wp_app_password,
          wc_consumer_key: form.wc_consumer_key || null,
          wc_consumer_secret: form.wc_consumer_secret || null,
        },
      });
      setProbe(result);
      if (result.ok) toast.success("Connection successful");
      else toast.error(result.error ?? "Test failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!probe?.ok) {
      toast.error("Run a successful test before saving");
      return;
    }
    setSaving(true);
    try {
      const res = await connect({
        data: {
          name: form.name,
          url: form.url,
          client_name: form.client_name || null,
          logo_url: form.logo_url || null,
          wp_username: form.wp_username,
          wp_app_password: form.wp_app_password,
          wc_consumer_key: form.wc_consumer_key || null,
          wc_consumer_secret: form.wc_consumer_secret || null,
        },
      });
      qc.invalidateQueries({ queryKey: ["websites"] });
      toast.success("Website connected");
      navigate({ to: "/websites/$id", params: { id: res.website.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/websites"><ArrowLeft className="mr-2 h-4 w-4" /> Back to websites</Link>
      </Button>

      <PageHeader title="Connect a website" description="Three quick steps. Credentials are tested before they're saved." />

      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`grid h-6 w-6 place-items-center rounded-full border ${i <= step ? "border-primary bg-primary text-primary-foreground" : "border-muted text-muted-foreground"}`}>
              {i + 1}
            </div>
            <span className={i === step ? "font-medium" : "text-muted-foreground"}>{label}</span>
            {i < STEPS.length - 1 ? <ArrowRight className="h-3 w-3 text-muted-foreground" /> : null}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site details</CardTitle>
            <CardDescription>How you'll recognize the site in the dashboard.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" value={form.name} onChange={update("name")} placeholder="My client" required />
            <Field label="WordPress URL" value={form.url} onChange={update("url")} placeholder="https://example.com" type="url" required />
            <Field label="Client name (optional)" value={form.client_name} onChange={update("client_name")} />
            <Field label="Logo URL (optional)" value={form.logo_url} onChange={update("logo_url")} type="url" />
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">WordPress credentials</CardTitle>
              <CardDescription>
                Create one under WP admin → Users → Profile → Application Passwords.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="WP username" value={form.wp_username} onChange={update("wp_username")} required />
              <Field label="Application password" value={form.wp_app_password} onChange={update("wp_app_password")} type="password" required />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">WooCommerce REST keys (optional)</CardTitle>
              <CardDescription>WooCommerce → Settings → Advanced → REST API. Permissions: Read/Write.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Consumer key" value={form.wc_consumer_key} onChange={update("wc_consumer_key")} placeholder="ck_…" />
              <Field label="Consumer secret" value={form.wc_consumer_secret} onChange={update("wc_consumer_secret")} placeholder="cs_…" type="password" />
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Test before saving
            </CardTitle>
            <CardDescription>
              We'll call the WordPress REST API (and WooCommerce, if keys provided) from our server. Nothing saves until the test succeeds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={runTest} disabled={testing} variant="outline">
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {probe ? "Re-run test" : "Run test"}
            </Button>

            {probe ? (
              probe.ok ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                  <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Connection successful
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {probe.info.theme ? <Badge variant="outline">Theme: {probe.info.theme}</Badge> : null}
                    {probe.info.plugins_count !== undefined ? <Badge variant="outline">{probe.info.plugins_count} plugins</Badge> : null}
                    {probe.info.woocommerce ? <Badge variant="secondary">WooCommerce detected</Badge> : <Badge variant="outline">No WooCommerce</Badge>}
                    {probe.info.products !== undefined ? <Badge variant="outline">{probe.info.products} products</Badge> : null}
                    {probe.info.orders !== undefined ? <Badge variant="outline">{probe.info.orders} orders</Badge> : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
                  <div className="flex items-center gap-2 font-medium text-destructive">
                    <AlertCircle className="h-4 w-4" /> Test failed
                  </div>
                  <p className="mt-1 text-destructive/90">{probe.error}</p>
                </div>
              )
            ) : (
              <p className="text-xs text-muted-foreground">No test run yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < 2 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={(step === 0 && !canNext0) || (step === 1 && !canNext1)}>
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={save} disabled={!probe?.ok || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save & connect
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input {...rest} />
    </div>
  );
}
