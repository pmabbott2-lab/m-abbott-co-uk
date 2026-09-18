/**
 * Gate G6 — Company Settings (tenant Owner / Supervisor).
 * Extends Management → Manage. Does not expose Create Company.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  Palette,
  Scale,
  ToggleLeft,
  Megaphone,
  Users,
  Phone,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { HubSubNav } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  getCompanySettings,
  updateCompanyDetails,
  updateCompanyBranding,
  updateCompanyRegulatory,
  updateCompanyFeature,
  updateCompanyCommunications,
  revokeTenantStaffAccess,
} from "@/lib/company-settings.server";

const CATEGORY_LABELS: Record<string, string> = {
  customer_journey: "Customer Journeys",
  public_access: "Public Access",
  staff_capability: "Staff",
  integration: "Integrations",
  comms: "Communications",
};

function NotConfigured({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        Regulatory / contact details are <strong>Not configured</strong>. Incomplete information is
        not shown as complete on customer-facing surfaces.
      </span>
    </div>
  );
}

export function CompanySettingsPanel() {
  const qc = useQueryClient();
  const getFn = useServerFn(getCompanySettings);
  const detailsFn = useServerFn(updateCompanyDetails);
  const brandingFn = useServerFn(updateCompanyBranding);
  const regulatoryFn = useServerFn(updateCompanyRegulatory);
  const featureFn = useServerFn(updateCompanyFeature);
  const commsFn = useServerFn(updateCompanyCommunications);
  const revokeFn = useServerFn(revokeTenantStaffAccess);

  const q = useQuery({ queryKey: ["company-settings"], queryFn: () => getFn() });
  const data = q.data;

  const [details, setDetails] = useState<Record<string, string> | null>(null);
  const [branding, setBranding] = useState<Record<string, string> | null>(null);
  const [regulatory, setRegulatory] = useState<Record<string, string> | null>(null);
  const [comms, setComms] = useState<Record<string, string> | null>(null);

  const detailsForm = details ?? {
    companyName: data?.tenant.companyName ?? "",
    tradingName: data?.tenant.tradingName ?? "",
    companyEmail: data?.tenant.companyEmail ?? "",
    telephone: data?.tenant.telephone ?? "",
    websiteUrl: data?.tenant.websiteUrl ?? "",
    legalName: data?.tenant.legalName ?? "",
  };
  const brandingForm = branding ?? {
    logoPath: data?.branding?.logo_path ?? "",
    primaryColour: data?.branding?.primary_colour ?? "",
    secondaryColour: data?.branding?.secondary_colour ?? "",
  };
  const regulatoryForm = regulatory ?? {
    legalName: data?.regulatory.legalName ?? "",
    tradingName: data?.regulatory.tradingName ?? "",
    fcaDetails: data?.regulatory.fcaDetails ?? "",
    companyNumber: data?.regulatory.companyNumber ?? "",
    registeredOffice: data?.regulatory.registeredOffice ?? "",
    fcaFrn: data?.regulatory.fcaFrn ?? "",
    privacyPolicyUrl: data?.regulatory.privacyPolicyUrl ?? "",
    termsUrl: data?.regulatory.termsUrl ?? "",
    complaintsUrl: data?.regulatory.complaintsUrl ?? "",
    dataControllerWording: data?.regulatory.dataControllerWording ?? "",
  };
  const commsForm = comms ?? {
    fromName: data?.communications.fromName ?? "",
    emailFooter: data?.communications.emailFooter ?? "",
    smsFooter: data?.communications.smsFooter ?? "",
    regulatoryFooter: data?.communications.regulatoryFooter ?? "",
  };

  const saveDetails = useMutation({
    mutationFn: () =>
      detailsFn({
        data: {
          companyName: detailsForm.companyName,
          tradingName: detailsForm.tradingName || null,
          companyEmail: detailsForm.companyEmail || null,
          telephone: detailsForm.telephone || null,
          websiteUrl: detailsForm.websiteUrl || null,
          legalName: detailsForm.legalName || null,
        },
      }),
    onSuccess: () => {
      toast.success("Company details saved");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const saveBranding = useMutation({
    mutationFn: () =>
      brandingFn({
        data: {
          logoPath: brandingForm.logoPath || null,
          primaryColour: brandingForm.primaryColour || null,
          secondaryColour: brandingForm.secondaryColour || null,
        },
      }),
    onSuccess: () => {
      toast.success("Branding saved");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const saveRegulatory = useMutation({
    mutationFn: () =>
      regulatoryFn({
        data: {
          legalName: regulatoryForm.legalName || null,
          tradingName: regulatoryForm.tradingName || null,
          fcaDetails: regulatoryForm.fcaDetails || null,
          companyNumber: regulatoryForm.companyNumber || null,
          registeredOffice: regulatoryForm.registeredOffice || null,
          fcaFrn: regulatoryForm.fcaFrn || null,
          privacyPolicyUrl: regulatoryForm.privacyPolicyUrl || null,
          termsUrl: regulatoryForm.termsUrl || null,
          complaintsUrl: regulatoryForm.complaintsUrl || null,
          dataControllerWording: regulatoryForm.dataControllerWording || null,
        },
      }),
    onSuccess: () => {
      toast.success("Regulatory details saved");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const saveComms = useMutation({
    mutationFn: () =>
      commsFn({
        data: {
          fromName: commsForm.fromName || null,
          emailFooter: commsForm.emailFooter || null,
          smsFooter: commsForm.smsFooter || null,
          regulatoryFooter: commsForm.regulatoryFooter || null,
        },
      }),
    onSuccess: () => {
      toast.success("Communications saved");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const toggleFeature = useMutation({
    mutationFn: (vars: { featureKey: string; enabled: boolean }) =>
      featureFn({ data: vars }),
    onSuccess: () => {
      toast.success("Feature updated");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const revoke = useMutation({
    mutationFn: (userId: string) => revokeFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("Tenant access removed (Auth identity preserved)");
      qc.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Remove failed"),
  });

  const featuresByCategory = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["features"]>();
    for (const f of data?.features ?? []) {
      const list = map.get(f.category) ?? [];
      list.push(f);
      map.set(f.category, list);
    }
    return [...map.entries()];
  }, [data?.features]);

  if (q.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading company settings…</p>;
  }
  if (q.isError || !data) {
    return (
      <p className="text-sm text-destructive">
        {q.error instanceof Error ? q.error.message : "Unable to load company settings."}
      </p>
    );
  }

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { multiline?: boolean; placeholder?: string },
  ) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {opts?.multiline ? (
        <Textarea
          value={value}
          placeholder={opts.placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      ) : (
        <Input
          value={value}
          placeholder={opts?.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      icon: <Building2 className="w-4 h-4 shrink-0" />,
      content: (
        <div className="space-y-4 max-w-xl">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Company code</dt>
              <dd className="font-mono">{data.tenant.companyCode}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Slug / route</dt>
              <dd className="font-mono">{data.routePreview}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Type</dt>
              <dd>
                {data.tenant.tenantType}{" "}
                <span className="text-xs text-muted-foreground">(platform-controlled)</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                {data.tenant.status}{" "}
                <span className="text-xs text-muted-foreground">(platform-controlled)</span>
              </dd>
            </div>
          </dl>
          <NotConfigured show={data.regulatory.notConfigured} />
        </div>
      ),
    },
    {
      id: "details",
      label: "Details",
      icon: <Building2 className="w-4 h-4 shrink-0" />,
      content: (
        <div className="space-y-3 max-w-xl">
          {field("Company name", detailsForm.companyName, (v) =>
            setDetails({ ...detailsForm, companyName: v }),
          )}
          {field("Trading name", detailsForm.tradingName, (v) =>
            setDetails({ ...detailsForm, tradingName: v }),
          )}
          {field("Contact email", detailsForm.companyEmail, (v) =>
            setDetails({ ...detailsForm, companyEmail: v }),
          )}
          {field("Telephone", detailsForm.telephone, (v) =>
            setDetails({ ...detailsForm, telephone: v }),
            { placeholder: "Not configured" },
          )}
          {field("Website", detailsForm.websiteUrl, (v) =>
            setDetails({ ...detailsForm, websiteUrl: v }),
            { placeholder: "Not configured" },
          )}
          {field("Legal name", detailsForm.legalName, (v) =>
            setDetails({ ...detailsForm, legalName: v }),
          )}
          <Button onClick={() => saveDetails.mutate()} disabled={saveDetails.isPending}>
            Save details
          </Button>
        </div>
      ),
    },
    {
      id: "branding",
      label: "Branding",
      icon: <Palette className="w-4 h-4 shrink-0" />,
      content: (
        <div className="space-y-3 max-w-xl">
          <p className="text-sm text-muted-foreground">
            Uses repository/static logo paths. Tenant-namespaced Storage upload is deferred until
            Storage isolation is ready.
          </p>
          {field("Logo path", brandingForm.logoPath, (v) =>
            setBranding({ ...brandingForm, logoPath: v }),
            { placeholder: "/tenant-branding/…" },
          )}
          {field("Primary colour", brandingForm.primaryColour, (v) =>
            setBranding({ ...brandingForm, primaryColour: v }),
            { placeholder: "#…" },
          )}
          {field("Secondary colour", brandingForm.secondaryColour, (v) =>
            setBranding({ ...brandingForm, secondaryColour: v }),
          )}
          <Button onClick={() => saveBranding.mutate()} disabled={saveBranding.isPending}>
            Save branding
          </Button>
        </div>
      ),
    },
    {
      id: "regulatory",
      label: "Regulatory",
      icon: <Scale className="w-4 h-4 shrink-0" />,
      content: (
        <div className="space-y-3 max-w-xl">
          <NotConfigured show={data.regulatory.notConfigured} />
          {field("Legal entity name", regulatoryForm.legalName, (v) =>
            setRegulatory({ ...regulatoryForm, legalName: v }),
          )}
          {field("Trading name", regulatoryForm.tradingName, (v) =>
            setRegulatory({ ...regulatoryForm, tradingName: v }),
          )}
          {field("Company number", regulatoryForm.companyNumber, (v) =>
            setRegulatory({ ...regulatoryForm, companyNumber: v }),
            { placeholder: "Not configured" },
          )}
          {field(
            "Registered office",
            regulatoryForm.registeredOffice,
            (v) => setRegulatory({ ...regulatoryForm, registeredOffice: v }),
            { multiline: true, placeholder: "Not configured" },
          )}
          {field("FCA FRN", regulatoryForm.fcaFrn, (v) =>
            setRegulatory({ ...regulatoryForm, fcaFrn: v }),
            { placeholder: "Not configured" },
          )}
          {field(
            "FCA / regulatory wording",
            regulatoryForm.fcaDetails,
            (v) => setRegulatory({ ...regulatoryForm, fcaDetails: v }),
            { multiline: true, placeholder: "Not configured" },
          )}
          {field("Privacy policy URL", regulatoryForm.privacyPolicyUrl, (v) =>
            setRegulatory({ ...regulatoryForm, privacyPolicyUrl: v }),
            { placeholder: "Not configured" },
          )}
          {field("Terms URL", regulatoryForm.termsUrl, (v) =>
            setRegulatory({ ...regulatoryForm, termsUrl: v }),
          )}
          {field("Complaints URL", regulatoryForm.complaintsUrl, (v) =>
            setRegulatory({ ...regulatoryForm, complaintsUrl: v }),
          )}
          {field(
            "Data controller wording",
            regulatoryForm.dataControllerWording,
            (v) => setRegulatory({ ...regulatoryForm, dataControllerWording: v }),
            { multiline: true },
          )}
          <Button onClick={() => saveRegulatory.mutate()} disabled={saveRegulatory.isPending}>
            Save regulatory
          </Button>
        </div>
      ),
    },
    {
      id: "features",
      label: "Features & Journeys",
      icon: <ToggleLeft className="w-4 h-4 shrink-0" />,
      content: (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Owner/Supervisor control is ON/OFF. Changes write to <code>tenant_features</code> and
            feed the G5 enforcement layer. Platform entitlement / rollout states are not exposed
            here.
          </p>
          {featuresByCategory.map(([category, rows]) => (
            <div key={category} className="space-y-3">
              <h4 className="text-sm font-semibold">{CATEGORY_LABELS[category] ?? category}</h4>
              <ul className="space-y-2">
                {rows.map((f: (typeof rows)[number]) => (
                  <li
                    key={f.featureKey}
                    className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.name}</p>
                      {f.description ? (
                        <p className="text-xs text-muted-foreground">{f.description}</p>
                      ) : null}
                      {f.dependency?.note ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          Requires configuration: {f.dependency.note}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      checked={f.effectiveEnabled}
                      disabled={toggleFeature.isPending || f.featureKey === "password_recovery"}
                      onCheckedChange={(enabled) =>
                        toggleFeature.mutate({ featureKey: f.featureKey, enabled })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "comms",
      label: "Communications",
      icon: <Megaphone className="w-4 h-4 shrink-0" />,
      content: (
        <div className="space-y-3 max-w-xl">
          <p className="text-sm text-muted-foreground">
            Brand wrapper (logo, colours, regulatory footer) stays separate from message template
            content. Template editing remains under Marketing → Scripts. No provider secrets here.
          </p>
          {field("Sender display name", commsForm.fromName, (v) =>
            setComms({ ...commsForm, fromName: v }),
          )}
          {field(
            "Email footer / brand wrapper",
            commsForm.emailFooter,
            (v) => setComms({ ...commsForm, emailFooter: v }),
            { multiline: true },
          )}
          {field(
            "SMS footer",
            commsForm.smsFooter,
            (v) => setComms({ ...commsForm, smsFooter: v }),
            { multiline: true },
          )}
          {field(
            "Regulatory footer",
            commsForm.regulatoryFooter,
            (v) => setComms({ ...commsForm, regulatoryFooter: v }),
            { multiline: true },
          )}
          <Button onClick={() => saveComms.mutate()} disabled={saveComms.isPending}>
            Save communications
          </Button>
        </div>
      ),
    },
    {
      id: "staff",
      label: "Staff & Access",
      icon: <Users className="w-4 h-4 shrink-0" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Invite new staff via Manage → Invites. Removing access deactivates this company&apos;s
            membership only — it does not delete the Auth account or other tenants&apos; memberships.
          </p>
          <ul className="space-y-2">
            {data.staff.map((s: (typeof data.staff)[number]) => (
              <li
                key={s.membershipId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{s.fullName || s.email || s.userId}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.role}
                    {!s.active ? " · inactive" : ""}
                    {s.email ? ` · ${s.email}` : ""}
                  </p>
                </div>
                {data.isOwner && s.active && s.role !== "owner" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (confirm("Remove this person's access to this company only?")) {
                        revoke.mutate(s.userId);
                      }
                    }}
                  >
                    Remove access
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    {
      id: "telephony",
      label: "Telephony",
      icon: <Phone className="w-4 h-4 shrink-0" />,
      content: (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm space-y-2 max-w-xl">
          <p className="font-medium">Configuration status</p>
          <p className="text-muted-foreground">{data.telephony.message}</p>
          <p className="text-xs text-muted-foreground">
            Future: dedicated Twilio subaccount, landline, adviser numbers, SMS, voice routing, usage
            attribution — not in G6.
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{data.tenant.companyName}</h3>
        <p className="text-sm text-muted-foreground">
          Company settings for this tenant. Create Company remains platform-only (future Super
          Owner).
        </p>
      </div>
      <HubSubNav tabs={tabs} defaultValue="overview" persistKey="mortgage-hub:company-settings" />
    </div>
  );
}
