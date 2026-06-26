import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createManualLead,
  getIntroducerProfile,
  listIntroducerReferrals,
  updateIntroducerProfile,
} from "@/lib/introducer.functions";
import { getMyRole } from "@/lib/sessions.functions";
import { referralLinkForSlug } from "@/lib/referral";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Link2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/introducer")({
  beforeLoad: async () => {
    // Role check happens in component via server fn; redirect non-introducers from home.
  },
  component: IntroducerPortal,
});

function CopyLinkButton({ url }: { url: string }) {
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
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function IntroducerPortal() {
  const qc = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const profileFn = useServerFn(getIntroducerProfile);
  const updateFn = useServerFn(updateIntroducerProfile);
  const leadsFn = useServerFn(listIntroducerReferrals);
  const createLeadFn = useServerFn(createManualLead);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
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
        data: {
          customerName,
          customerPhone,
          customerEmail,
          notes,
        },
      }),
    onSuccess: () => {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["introducer-referrals"] });
    },
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
  const leads = referralsQ.data?.leads ?? [];
  const sessions = referralsQ.data?.sessions ?? [];

  return (
    <AppShell title="Introducer portal">
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold">Introducer portal</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Share your referral link or log a lead when a customer prefers not to self-serve.
          </p>
        </div>

        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-medium">
            <Link2 className="w-4 h-4" />
            Your referral link
          </div>
          <p className="text-sm text-muted-foreground">
            Paste this on your website. Customers who click it are automatically linked to you for
            fact-finds and future bookings.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input readOnly value={referralUrl} className="font-mono text-sm" />
            <CopyLinkButton url={referralUrl} />
          </div>
          <p className="text-xs text-muted-foreground">
            Embed snippet:{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
              {`<a href="${referralUrl}">Book your mortgage appointment</a>`}
            </code>
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <h3 className="font-medium">Your details</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company / trading name</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input
                id="contactEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={updateProfile.isPending}
            onClick={() =>
              updateProfile.mutate()
            }
          >
            {updateProfile.isPending ? "Saving…" : "Save details"}
          </Button>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-medium">
            <UserPlus className="w-4 h-4" />
            Log a lead manually
          </div>
          <p className="text-sm text-muted-foreground">
            For customers who won&apos;t self-serve. Diary booking arrives tomorrow — for now we save
            the lead for follow-up.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customerName">Customer name</Label>
              <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerPhone">Phone</Label>
              <Input id="customerPhone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="customerEmail">Email (optional)</Label>
              <Input
                id="customerEmail"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <Button
            disabled={createLead.isPending || !customerName || !customerPhone}
            onClick={() => createLead.mutate()}
          >
            {createLead.isPending ? "Saving…" : "Save lead"}
          </Button>
          {createLead.isSuccess && (
            <p className="text-sm text-accent-foreground bg-accent/20 rounded-lg px-3 py-2">
              Lead saved. You can book them into the diary once that&apos;s live.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">Your referrals</h3>
          <div className="rounded-2xl border bg-card divide-y">
            {leads.length === 0 && sessions.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">No referrals yet — share your link or log a lead above.</div>
            )}
            {leads.map((lead) => (
              <div key={lead.id} className="p-4">
                <div className="font-medium">{lead.customer_name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Manual lead · {lead.customer_phone}
                  {lead.customer_email ? ` · ${lead.customer_email}` : ""} ·{" "}
                  {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                </div>
                {lead.notes && <p className="text-sm mt-2 text-muted-foreground">{lead.notes}</p>}
              </div>
            ))}
            {sessions.map((session) => (
              <div key={session.id} className="p-4">
                <div className="font-medium">Fact-find session</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {session.referral_channel ?? "voice"} · {session.lead_source ?? "referral"} ·{" "}
                  {session.status === "submitted" ? "Submitted" : "In progress"} ·{" "}
                  {formatDistanceToNow(new Date(session.started_at), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
