import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { IntroducerCustomerBookingCard } from "@/components/IntroducerCustomerBookingCard";
import { MyCommissionStatementPanel } from "@/components/MyCommissionStatementPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HubSubNav, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getIntroducerProfile,
  listIntroducerReferrals,
  updateIntroducerProfile,
} from "@/lib/introducer.functions";
import { sendLeadBookingSms } from "@/lib/booking.functions";
import {
  marketingCalculatorLinkForSlug,
  marketingJourneyLinkForSlug,
  referralLinkForSlug,
} from "@/lib/referral";
import { format } from "date-fns";
import { Calendar, Check, Copy, Hash, Link2, MessageSquare, PoundSterling, Search } from "lucide-react";
import { ReportExportBox } from "@/components/ReportExportBox";
import { ReportTableScroll } from "@/components/ReportTableScroll";
import { introducerReferralsToSheet } from "@/lib/report-mappers";

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

type IntroducerPortalContentProps = {
  /** When true, omit page title block (embedded in staff dashboard branch). */
  embedded?: boolean;
  /** Owner/supervisor acting as another introducer. */
  viewAsIntroducerUserId?: string | null;
  viewAsLabel?: string;
};

export function IntroducerPortalContent({
  embedded = false,
  viewAsIntroducerUserId = null,
  viewAsLabel,
}: IntroducerPortalContentProps) {
  const qc = useQueryClient();
  const profileFn = useServerFn(getIntroducerProfile);
  const updateFn = useServerFn(updateIntroducerProfile);
  const leadsFn = useServerFn(listIntroducerReferrals);
  const smsFn = useServerFn(sendLeadBookingSms);

  const viewAs = viewAsIntroducerUserId ?? undefined;
  const viewAsPayload = viewAs ? { viewAsIntroducerUserId: viewAs } : {};

  const profileQ = useQuery({
    queryKey: ["introducer-profile", viewAs ?? "self"],
    queryFn: () => profileFn({ data: viewAsPayload }),
  });
  const referralsQ = useQuery({
    queryKey: ["introducer-referrals", viewAs ?? "self"],
    queryFn: () => leadsFn({ data: viewAsPayload }),
    enabled: profileQ.isSuccess,
  });

  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [referralSearch, setReferralSearch] = useState("");

  useEffect(() => {
    if (profileQ.data) {
      setCompanyName(profileQ.data.company_name);
      setContactEmail(profileQ.data.contact_email ?? "");
    }
  }, [profileQ.data]);

  const updateProfile = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          companyName,
          contactEmail,
          ...viewAsPayload,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["introducer-profile"] });
      qc.invalidateQueries({ queryKey: ["view-as-audit"] });
    },
  });

  const sendSms = useMutation({
    mutationFn: (leadId: string) =>
      smsFn({
        data: {
          leadId,
          ...viewAsPayload,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["introducer-referrals"] });
      qc.invalidateQueries({ queryKey: ["view-as-audit"] });
    },
  });

  if (profileQ.isLoading || !profileQ.data) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        {profileQ.isLoading ? "Loading your portal…" : "Setting up your portal…"}
      </div>
    );
  }

  if (profileQ.isError) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Couldn&apos;t load your introducer profile — try refreshing.
      </div>
    );
  }

  const profile = profileQ.data;
  const referralUrl = referralLinkForSlug(profile.slug);
  const journeyWebUrl = marketingJourneyLinkForSlug(profile.slug);
  const calculatorWebUrl = marketingCalculatorLinkForSlug(profile.slug);
  const companyCode = (profile as { company_code?: string | null }).company_code ?? null;
  const referrals = referralsQ.data?.referrals ?? [];
  const referralQuery = referralSearch.trim().toLowerCase();
  const filteredReferrals = referrals.filter((r) => {
    if (!referralQuery) return true;
    const haystack = [
      r.customerName,
      r.customerPhone,
      r.customerEmail,
      r.journeyStage,
      r.leadSource,
      r.advisorName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(referralQuery);
  });
  const referralExportSheet = introducerReferralsToSheet(filteredReferrals);

  const overviewContent = (
    <div className="space-y-8">
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
        <p className="text-sm text-muted-foreground">
          Direct customers to Mortgage Hub to self-serve (voice, chat, or book). Attribution is
          recorded via your referral cookie.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input readOnly value={referralUrl} className="font-mono text-sm" />
          <CopyLinkButton url={referralUrl} label="Copy link" />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2 font-medium">
          <Link2 className="w-4 h-4" />
          MortgageEasy website links
        </div>
        <p className="text-sm text-muted-foreground">
          Share these on your website, email, or socials. The <code className="text-xs">ref</code>{" "}
          parameter attributes calculator callbacks and customer journeys to you on the marketing
          site.
        </p>
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">
              Three ways to start a mortgage journey
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input readOnly value={journeyWebUrl} className="font-mono text-xs sm:text-sm" />
              <CopyLinkButton url={journeyWebUrl} label="Copy journey link" />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Mortgage calculator</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input readOnly value={calculatorWebUrl} className="font-mono text-xs sm:text-sm" />
              <CopyLinkButton url={calculatorWebUrl} label="Copy calculator link" />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 space-y-4">
        <h3 className="font-medium">Your details</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="introducer-companyName">Company / trading name</Label>
            <Input
              id="introducer-companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="introducer-contactEmail">Contact email</Label>
            <Input
              id="introducer-contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
        </div>
        <Button
          variant="secondary"
          disabled={updateProfile.isPending}
          onClick={() => updateProfile.mutate()}
        >
          {updateProfile.isPending ? "Saving…" : "Save details"}
        </Button>
      </section>

      <section className="rounded-2xl border bg-card p-6 space-y-4">
        <div>
          <h3 className="font-medium">Book an appointment for a customer</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Book directly or send a link. The customer receives text and email confirmation with
            options to complete the fact-find by voice, by typing, or to confirm attendance only.
          </p>
        </div>
        <IntroducerCustomerBookingCard
          viewAsIntroducerUserId={viewAs}
          onBooked={() => qc.invalidateQueries({ queryKey: ["introducer-referrals"] })}
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h3 className="font-medium">Your referrals</h3>
            <p className="text-sm text-muted-foreground">
              Customer name, contact details, journey stage, lead source, advisor and contact dates.
            </p>
          </div>
          <ReportExportBox
            filename={`introducer-referrals-${new Date().toISOString().slice(0, 10)}`}
            label="Export referrals"
            sheets={[referralExportSheet]}
            pdfTitle="Introducer referrals"
            pdfSections={[
              {
                title: "Referrals",
                headers: referralExportSheet.headers,
                rows: referralExportSheet.rows,
              },
            ]}
          />
        </div>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search referrals by name, phone, email, stage…"
            value={referralSearch}
            onChange={(e) => setReferralSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <ReportTableScroll visibleRows={8} className="rounded-2xl border bg-card">
          <div className="divide-y">
            {referralsQ.isLoading && (
              <div className="p-6 text-sm text-muted-foreground">Loading referrals…</div>
            )}
            {!referralsQ.isLoading && filteredReferrals.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">
                {referralQuery ? "No referrals match your search." : "No referrals yet."}
              </div>
            )}
            {filteredReferrals.map((r) => (
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
        </ReportTableScroll>
      </section>
    </div>
  );

  const commissionContent = (
    <MyCommissionStatementPanel
      embedded
      viewAsUserId={viewAs}
      title={viewAs ? `Introducer commission — ${viewAsLabel ?? "view as"}` : "My introducer commission"}
      description="Commission from posted fees on cases linked to customers you introduced. Pending until marked paid by admin."
    />
  );

  const portalTabs = [
    { id: "overview", label: "Overview", content: overviewContent },
    {
      id: "commission",
      label: (
        <>
          <PoundSterling className="w-4 h-4 shrink-0" />
          My commission
        </>
      ),
      content: commissionContent,
    },
  ];

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h2 className="text-2xl font-semibold">Introducer portal</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Share your link so customers can self-serve on Mortgage Hub, or book an appointment for a
            customer yourself. Either way, the referral is recorded against you.
          </p>
        </div>
      )}

      {embedded && !viewAs && (
        <p className="text-sm text-muted-foreground">
          Share referral links, log leads, and track booked appointments. Commission is under{" "}
          <strong>Finance → My commission</strong> on the top bar, or use the tab below.
        </p>
      )}

      {viewAs && viewAsLabel && (
        <p className="text-sm text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
          Viewing as <strong>{viewAsLabel}</strong> — changes you make here are recorded in the audit
          log below.
        </p>
      )}

      {embedded || viewAs ? (
        <HubSubNav tabs={portalTabs} defaultValue="overview" />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList variant="hub" className="max-w-md">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="commission">
              <PoundSterling className="w-4 h-4 shrink-0" />
              My commission
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-8 mt-0">
            {overviewContent}
          </TabsContent>

          <TabsContent value="commission" className="mt-0">
            {commissionContent}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
