import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
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
import { bookingLinkForSlug, referralLinkForSlug } from "@/lib/referral";
import { format, formatDistanceToNow } from "date-fns";
import { Calendar, Check, Copy, Link2, MessageSquare, UserPlus } from "lucide-react";

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
    onSuccess: () => {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["introducer-referrals"] });
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
  const bookingUrl = bookingLinkForSlug(profile.slug);
  const leads = referralsQ.data?.leads ?? [];
  const appointments = referralsQ.data?.appointments ?? [];

  return (
    <AppShell title="Introducer portal">
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold">Introducer portal</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Separate from the fact-find app. Share links, book appointments, and text customers who
            prefer not to self-serve.
          </p>
        </div>

        <section className="rounded-2xl border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-medium">
            <Link2 className="w-4 h-4" />
            Links for your website
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Direct booking (skips fact-find)</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input readOnly value={bookingUrl} className="font-mono text-sm" />
                <CopyLinkButton url={bookingUrl} label="Copy booking link" />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Short referral link (redirects to booking)</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input readOnly value={referralUrl} className="font-mono text-sm" />
                <CopyLinkButton url={referralUrl} label="Copy short link" />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Embed:{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
              {`<a href="${bookingUrl}">Book your mortgage appointment</a>`}
            </code>
          </p>
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
            Log a lead manually
          </div>
          <p className="text-sm text-muted-foreground">
            For customers who won&apos;t self-serve. Book them into the diary or text them a booking link.
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
              <Input id="customerEmail" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <Button disabled={createLead.isPending || !customerName || !customerPhone} onClick={() => createLead.mutate()}>
            {createLead.isPending ? "Saving…" : "Save lead"}
          </Button>
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">Your referrals</h3>
          <div className="rounded-2xl border bg-card divide-y">
            {leads.length === 0 && appointments.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">No referrals yet.</div>
            )}
            {leads.map((lead) => (
              <div key={lead.id} className="p-4 space-y-3">
                <div>
                  <div className="font-medium">{lead.customer_name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {lead.status} · {lead.customer_phone}
                    {lead.customer_email ? ` · ${lead.customer_email}` : ""} ·{" "}
                    {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                  </div>
                  {lead.notes && <p className="text-sm mt-2 text-muted-foreground">{lead.notes}</p>}
                </div>
                {lead.status !== "booked" && (
                  <div className="flex flex-wrap gap-2">
                    <Link to="/book/$slug" params={{ slug: profile.slug }} search={{ lead: lead.id }}>
                      <Button size="sm" variant="secondary">
                        <Calendar className="w-3.5 h-3.5 mr-1.5" />
                        Book into diary
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!lead.customer_phone || sendSms.isPending}
                      onClick={() => sendSms.mutate(lead.id)}
                    >
                      <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                      Text booking link
                    </Button>
                  </div>
                )}
                {sendSms.isError && sendSms.variables === lead.id && (
                  <p className="text-xs text-destructive">{(sendSms.error as Error).message}</p>
                )}
              </div>
            ))}
            {appointments.map((appt) => (
              <div key={appt.id} className="p-4">
                <div className="font-medium">{appt.customer_name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Appointment · {format(new Date(appt.starts_at), "EEE d MMM, HH:mm")} · {appt.customer_phone}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
