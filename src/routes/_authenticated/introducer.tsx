import { createFileRoute, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TabPageNav } from "@/components/TabPageNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  checkIsIntroducer,
  createManualLead,
  getIntroducerProfile,
  listIntroducerReferrals,
  updateIntroducerProfile,
} from "@/lib/introducer.functions";
import { sendLeadBookingSms } from "@/lib/booking.functions";
import { referralLinkForSlug } from "@/lib/referral";
import { format } from "date-fns";
import { Calendar, Check, Copy, Hash, Link2, MessageSquare, PoundSterling, UserPlus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MyCommissionStatementPanel } from "@/components/MyCommissionStatementPanel";

export const Route = createFileRoute("/_authenticated/introducer")({
  component: IntroducerPortal,
});

function CopyLinkButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function IntroducerPortal() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const roleFn = useServerFn(checkIsIntroducer);
  const profileFn = useServerFn(getIntroducerProfile);
  const updateFn = useServerFn(updateIntroducerProfile);
  const leadsFn = useServerFn(listIntroducerReferrals);
  const createLeadFn = useServerFn(createManualLead);
  const smsFn = useServerFn(sendLeadBookingSms);

  const roleQ = useQuery({ queryKey: ["is-introducer"], queryFn: () => roleFn() });
  const profileQ = useQuery({
    queryKey: ["introducer-profile"],
    queryFn: () => profileFn(),
    enabled: roleQ.data?.isIntroducer === true,
  });
  const referralsQ = useQuery({
    queryKey: ["introducer-referrals"],
    queryFn: () => leadsFn(),
    enabled: roleQ.data?.isIntroducer === true,
  });

  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (profileQ.data) {
      setCompanyName(profileQ.data.company_name);
      setContactEmail(profileQ.data.contact_email ?? "");
    }
  }, [profileQ.data]);

  const updateProfile = useMutation({
    mutationFn: () => updateFn({ data: { companyName, contactEmail } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["introducer-profile"] }),
  });

  const createLead = useMutation({
    mutationFn: () =>
      createLeadFn({
        data: { customerName, customerPhone, customerEmail, notes },
      }),
    onSuccess: (lead) => {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["introducer-referrals"] });
      if (profileQ.data) {
        navigate({
          to: "/book/$slug",
          params: { slug: profileQ.data.slug },
          search: { lead: lead.id },
        });
      }
    },
  });

  const sendSms = useMutation({
    mutationFn: (leadId: string) => smsFn({ data: { leadId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["introducer-referrals"] }),
  });

  if (roleQ.isLoading) {
    return (
      <AppShell title="Introducer portal">
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (!roleQ.data?.isIntroducer) {
    throw redirect({ to: "/home" });
  }

  if (profileQ.isLoading || !profileQ.data) {
    return (
      <AppShell title="Introducer portal">
        <div className="py-16 text-center text-muted-foreground">Setting up your portal…</div>
      </AppShell>
    );
  }

  const profile = profileQ.data;
  const referralUrl = referralLinkForSlug(profile.slug);
  const companyCode = (profile as { company_code?: string | null }).company_code ?? null;
  const referrals = referralsQ.data?.referrals ?? [];

  return (
    <AppShell title="Introducer portal">
      <div className="space-y-6">
        <TabPageNav backTo="/home" backLabel="Home" />
        <div>
          <h2 className="text-2xl font-semibold">Introducer portal</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Share your link so customers can self-serve on Mortgage Hub, or book an appointment for a
            customer yourself. Either way, the referral is recorded against you.
          </p>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="commission">
              <PoundSterling className="w-4 h-4 mr-1.5" />
              My commission
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-8 mt-0">
        {companyCode && (
          <section className="rounded-2xl border bg-card p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-medium">
                <Hash className="w-4 h-4" />
                Your company code
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Share this 4-digit code with colleagues so they join the same company.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-3xl font-semibold tracking-widest">{companyCode}</span>
              <CopyLinkButton url={companyCode} label="Copy code" />
            </div>
          </section>
        )}

        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-medium">
            <Link2 className="w-4 h-4" />
            Your shareable link
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input readOnly value={referralUrl} className="font-mono text-sm" />
            <CopyLinkButton url={referralUrl} label="Copy link" />
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <h3 className="font-medium">Your details</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company / trading name</Label>
              <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>
          <Button variant="secondary" disabled={updateProfile.isPending} onClick={() => updateProfile.mutate()}>
            {updateProfile.isPending ? "Saving…" : "Save details"}
          </Button>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-medium">
            <UserPlus className="w-4 h-4" />
            Book an appointment for a customer
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customerName">Customer name</Label>
              <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerPhone">Phone</Label>
              <Input id="customerPhone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
          </div>
          <Button disabled={createLead.isPending || !customerName || !customerPhone} onClick={() => createLead.mutate()}>
            <Calendar className="w-4 h-4 mr-2" />
            {createLead.isPending ? "Opening diary…" : "Book an appointment for a customer"}
          </Button>
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">Your referrals</h3>
          <p className="text-sm text-muted-foreground">
            Customer name, contact details, journey stage, lead source, advisor and contact dates.
          </p>
          <div className="rounded-2xl border bg-card divide-y">
            {referralsQ.isLoading && (
              <div className="p-6 text-sm text-muted-foreground">Loading referrals…</div>
            )}
            {!referralsQ.isLoading && referrals.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">No referrals yet.</div>
            )}
            {referrals.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="p-4 sm:p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="font-semibold text-base">{r.customerName || "Unnamed customer"}</div>
                    <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {r.customerPhone && (
                        <>
                          <dt className="text-muted-foreground">Phone</dt>
                          <dd>{r.customerPhone}</dd>
                        </>
                      )}
                      {r.customerEmail && (
                        <>
                          <dt className="text-muted-foreground">Email</dt>
                          <dd className="break-all">{r.customerEmail}</dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">Stage</dt>
                      <dd>{r.journeyStage}</dd>
                      <dt className="text-muted-foreground">Lead source</dt>
                      <dd>{r.leadSource}</dd>
                      <dt className="text-muted-foreground">Advisor</dt>
                      <dd>{r.advisorName ?? "—"}</dd>
                      <dt className="text-muted-foreground">Days at stage</dt>
                      <dd>{r.daysAtStage}</dd>
                      <dt className="text-muted-foreground">Last contact</dt>
                      <dd>
                        {r.lastContactDate
                          ? format(new Date(r.lastContactDate), "d MMM yyyy")
                          : "—"}
                      </dd>
                    </dl>
                  </div>
                  {r.leadId && r.journeyStage === "Not started" && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Link to="/book/$slug" params={{ slug: profile.slug }} search={{ lead: r.leadId }}>
                        <Button size="sm" variant="secondary">
                          <Calendar className="w-3.5 h-3.5 mr-1.5" />
                          Book
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sendSms.isPending}
                        onClick={() => sendSms.mutate(r.leadId!)}
                      >
                        <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                        Text link
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
          </TabsContent>

          <TabsContent value="commission" className="mt-0">
            <MyCommissionStatementPanel
              title="My introducer commission"
              description="Commission from posted fees on cases linked to customers you introduced. Pending until marked paid by admin."
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
