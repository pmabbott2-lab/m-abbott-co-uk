/**
 * Gate G6 — Create Company wizard (future Super Owner only).
 * Current users: canAccessPlatformCompanies → ok:false → empty shell.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TenantAppLink as Link } from "@/components/tenant/TenantAppLink";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  canAccessPlatformCompanies,
  listPlatformCompanies,
  provisionCompany,
} from "@/lib/company-provisioning.server";

function previewSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const STEPS = [
  "Company Type",
  "Company Details",
  "Branding",
  "Regulatory",
  "Features & Journeys",
  "Communications",
  "Initial Owner",
  "Review",
  "Create",
] as const;

export function CreateCompanyWizard({ cancelTo = "/home" }: { cancelTo?: "/home" | "/platform" }) {
  const accessFn = useServerFn(canAccessPlatformCompanies);
  const listFn = useServerFn(listPlatformCompanies);
  const provisionFn = useServerFn(provisionCompany);

  const accessQ = useQuery({
    queryKey: ["platform-companies-access"],
    queryFn: () => accessFn(),
  });

  const listQ = useQuery({
    queryKey: ["platform-companies"],
    queryFn: () => listFn(),
    enabled: accessQ.data?.ok === true,
  });

  const [step, setStep] = useState(0);
  const [tenantType, setTenantType] = useState<"GROUP" | "EXTERNAL">("EXTERNAL");
  const [companyName, setCompanyName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [slug, setSlug] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [telephone, setTelephone] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [primaryColour, setPrimaryColour] = useState("");
  const [secondaryColour, setSecondaryColour] = useState("");
  const [logoPath, setLogoPath] = useState("");
  const [legalName, setLegalName] = useState("");
  const [fcaDetails, setFcaDetails] = useState("");
  const [fromName, setFromName] = useState("");
  const [emailFooter, setEmailFooter] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [enabledFeatures, setEnabledFeatures] = useState<string[]>([]);

  const slugPreview = useMemo(() => previewSlug(slug || companyName), [slug, companyName]);

  const create = useMutation({
    mutationFn: () =>
      provisionFn({
        data: {
          tenantType,
          companyName,
          tradingName: tradingName || null,
          slug: slugPreview,
          companyEmail: companyEmail || null,
          telephone: telephone || null,
          websiteUrl: websiteUrl || null,
          legalName: legalName || null,
          fcaDetails: fcaDetails || null,
          primaryColour: primaryColour || null,
          secondaryColour: secondaryColour || null,
          logoPath: logoPath || null,
          enabledFeatures,
          fromName: fromName || null,
          emailFooter: emailFooter || null,
          initialOwner: { email: ownerEmail, fullName: ownerName || null },
          activate: true,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Company ${res.companyCode} created`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Provisioning denied"),
  });

  if (accessQ.isLoading) {
    return <p className="text-sm text-muted-foreground p-6">Checking platform authority…</p>;
  }

  if (!accessQ.data?.ok) {
    return (
      <div className="max-w-lg mx-auto p-8 space-y-3">
        <h1 className="text-xl font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Create Company requires platform Super Owner authority. That role is not assigned yet.
          Tenant Owners cannot create companies.
        </p>
        <Button asChild variant="outline">
          <Link to={cancelTo}>{cancelTo === "/platform" ? "Back to platform" : "Back to workspace"}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Create Company</h1>
        <p className="text-sm text-muted-foreground">
          Platform Super Owner workflow · Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
      </div>

      {listQ.data && listQ.data.length > 0 ? (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="font-medium mb-2">Existing companies</p>
          <ul className="space-y-1">
            {listQ.data.map((t: (typeof listQ.data)[number]) => (
              <li key={t.id} className="font-mono text-xs">
                {t.company_code} — {t.company_name} ({t.slug}) · {t.tenant_type}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            GROUP = within our group/platform estate. EXTERNAL = independent licensee (strongest
            isolation by default).
          </p>
          <div className="flex gap-3">
            <Button
              variant={tenantType === "GROUP" ? "default" : "outline"}
              onClick={() => setTenantType("GROUP")}
            >
              GROUP
            </Button>
            <Button
              variant={tenantType === "EXTERNAL" ? "default" : "outline"}
              onClick={() => setTenantType("EXTERNAL")}
            >
              EXTERNAL
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Default for licensees: EXTERNAL</p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Company name</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Trading name</Label>
            <Input value={tradingName} onChange={(e) => setTradingName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tenant slug</Label>
            <Input
              value={slug}
              placeholder={slugPreview}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Route preview: mymortgagehub.uk/{slugPreview || "…"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Contact email</Label>
            <Input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Telephone</Label>
            <Input value={telephone} onChange={(e) => setTelephone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Website</Label>
            <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Neutral defaults — does not copy Mortgage Easy branding.
          </p>
          <div className="space-y-1.5">
            <Label>Logo path (static)</Label>
            <Input value={logoPath} onChange={(e) => setLogoPath(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Primary colour</Label>
            <Input value={primaryColour} onChange={(e) => setPrimaryColour(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Secondary colour</Label>
            <Input value={secondaryColour} onChange={(e) => setSecondaryColour(e.target.value)} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Legal name</Label>
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>FCA / regulatory wording</Label>
            <Textarea value={fcaDetails} onChange={(e) => setFcaDetails(e.target.value)} rows={3} />
          </div>
          <p className="text-xs text-muted-foreground">Leave blank if not configured — do not invent.</p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Explicit opt-in only. New companies start from neutral defaults (features off unless
            selected).
          </p>
          {["appointment_booking", "customer_portal", "staff_diary", "staff_crm"].map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabledFeatures.includes(key)}
                onChange={(e) => {
                  setEnabledFeatures((prev) =>
                    e.target.checked ? [...prev, key] : prev.filter((k) => k !== key),
                  );
                }}
              />
              {key}
            </label>
          ))}
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Sender display name</Label>
            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email brand footer</Label>
            <Textarea value={emailFooter} onChange={(e) => setEmailFooter(e.target.value)} rows={3} />
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Initial Owner email</Label>
            <Input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Creates a tenant-bound invitation. Membership is granted only on acceptance — not from
            email text alone.
          </p>
        </div>
      )}

      {step === 7 && (
        <div className="rounded-lg border border-border p-4 text-sm space-y-1 font-mono">
          <p>type: {tenantType}</p>
          <p>name: {companyName}</p>
          <p>slug: {slugPreview}</p>
          <p>route: mymortgagehub.uk/{slugPreview}</p>
          <p>owner: {ownerEmail}</p>
          <p>features: {enabledFeatures.join(", ") || "(none)"}</p>
        </div>
      )}

      {step === 8 && (
        <div className="space-y-3">
          <p className="text-sm">
            Activate creates the tenant atomically with config shells and the Initial Owner invite.
          </p>
          <Button
            disabled={create.isPending || !companyName || !ownerEmail}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create / Activate"}
          </Button>
          {create.data ? (
            <p className="text-sm text-green-700 dark:text-green-400">
              Created {create.data.companyCode} · invite token issued (do not email in tests)
            </p>
          ) : null}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        <Button disabled={step >= STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
