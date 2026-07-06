import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { BrowserSoftphone } from "@/components/BrowserSoftphone";
import { prepareBrowserCall } from "@/lib/telephony.functions";
import { formatDobDisplay } from "@/lib/dob-parse";

export function CrmContactCard({
  sessionId,
  customer,
  clickToCall = false,
}: {
  sessionId: string;
  customer: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    address?: string | null;
    date_of_birth?: string | null;
  } | null;
  clickToCall?: boolean;
}) {
  const qc = useQueryClient();
  const prepareFn = useServerFn(prepareBrowserCall);

  if (!customer) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <h3 className="font-semibold mb-1">Contact details</h3>
        <p className="text-sm text-muted-foreground">No contact details on file for this customer yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold">Contact details</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Call from your browser — the customer sees your Twilio office number. Recordings and summaries
          are saved to this case history.
        </p>
      </div>

      {clickToCall && customer.phone && (
        <BrowserSoftphone
          customerName={customer.full_name}
          customerPhone={customer.phone}
          onCall={async () => {
            const result = await prepareFn({
              data: { sessionId, customerPhone: customer.phone! },
            });
            return result;
          }}
          onCallComplete={() => {
            qc.invalidateQueries({ queryKey: ["session", sessionId] });
            qc.invalidateQueries({ queryKey: ["contact-history", sessionId] });
            qc.invalidateQueries({ queryKey: ["session-voicemails", sessionId] });
          }}
        />
      )}

      {clickToCall && !customer.phone && (
        <p className="text-sm text-amber-700 dark:text-amber-400 rounded-lg border border-amber-200/80 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2">
          Add a mobile number on the customer profile to enable click-to-call.
        </p>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {customer.full_name && (
          <div>
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="text-sm font-medium">{customer.full_name}</dd>
          </div>
        )}
        {customer.email && (
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="text-sm font-medium break-all">{customer.email}</dd>
          </div>
        )}
        {customer.phone && (
          <div>
            <dt className="text-xs text-muted-foreground">Mobile</dt>
            <dd className="text-sm font-medium">{customer.phone}</dd>
          </div>
        )}
        {customer.date_of_birth && (
          <div>
            <dt className="text-xs text-muted-foreground">Date of birth</dt>
            <dd className="text-sm font-medium">{formatDobDisplay(customer.date_of_birth)}</dd>
          </div>
        )}
        {customer.address && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-muted-foreground">Address</dt>
            <dd className="text-sm font-medium">{customer.address}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
