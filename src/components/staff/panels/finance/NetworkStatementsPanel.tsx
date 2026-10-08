import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  allocateNetworkLine,
  annotateNetworkLine,
  confirmNetworkStatementReceivedDate,
  deallocateNetworkLine,
  getNetworkStatementDetail,
  getOrCreateNetworkStatement,
  listNetworkStatementMonths,
  parseNetworkStatementWithAi,
  setNetworkLineSkip,
  setNetworkLineTransactionDate,
  setNetworkStatementDeclaredTotal,
  validateNetworkStatement,
} from "@/lib/network-commission.functions";
import { FEE_TYPE_LABELS } from "@/lib/finance.functions";

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

const ACCEPT_TYPES =
  ".csv,.txt,.tsv,.text,text/csv,text/plain,text/tab-separated-values,application/vnd.ms-excel";

async function readStatementFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".pdf") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  ) {
    throw new Error("Please upload CSV or TXT (save Excel/PDF as CSV or copy as text first).");
  }
  if (file.size > 2_000_000) {
    throw new Error("File is too large (max 2 MB). Split the statement or save a smaller CSV.");
  }
  const text = await file.text();
  if (text.trim().length < 20) {
    throw new Error("File looks empty — check the export and try again.");
  }
  const sample = text.slice(0, 500);
  const nonPrintable = (sample.match(/[^\x09\x0a\x0d\x20-\x7e]/g) ?? []).length;
  if (nonPrintable > sample.length * 0.3) {
    throw new Error("File does not look like text/CSV. Export from the network as CSV or TXT.");
  }
  return text;
}

export function NetworkStatementsPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const monthsFn = useServerFn(listNetworkStatementMonths);
  const createFn = useServerFn(getOrCreateNetworkStatement);
  const detailFn = useServerFn(getNetworkStatementDetail);
  const parseFn = useServerFn(parseNetworkStatementWithAi);
  const allocateFn = useServerFn(allocateNetworkLine);
  const deallocateFn = useServerFn(deallocateNetworkLine);
  const skipFn = useServerFn(setNetworkLineSkip);
  const lineDateFn = useServerFn(setNetworkLineTransactionDate);
  const receivedFn = useServerFn(confirmNetworkStatementReceivedDate);
  const declaredFn = useServerFn(setNetworkStatementDeclaredTotal);
  const annotateFn = useServerFn(annotateNetworkLine);
  const validateFn = useServerFn(validateNetworkStatement);

  const monthsQ = useQuery({
    queryKey: ["network-statement-months"],
    queryFn: () => monthsFn(),
  });

  const [periodMonth, setPeriodMonth] = useState<string>("");
  const [statementId, setStatementId] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [sessionByLine, setSessionByLine] = useState<Record<string, string>>({});
  const [noteByLine, setNoteByLine] = useState<Record<string, string>>({});
  const [dateByLine, setDateByLine] = useState<Record<string, string>>({});
  const [reasonByLine, setReasonByLine] = useState<Record<string, string>>({});
  const [receivedDate, setReceivedDate] = useState("");
  const [receivedConfirmed, setReceivedConfirmed] = useState(false);
  const [receivedEvidence, setReceivedEvidence] = useState("");
  const [declaredPounds, setDeclaredPounds] = useState("");
  const [unlockReason, setUnlockReason] = useState("");

  const effectivePeriod = periodMonth || monthsQ.data?.months?.[0]?.periodMonth || "";

  const detailQ = useQuery({
    queryKey: ["network-statement-detail", statementId],
    queryFn: () => detailFn({ data: { statementId: statementId! } }),
    enabled: Boolean(statementId),
  });

  const openMonth = useMutation({
    mutationFn: async (period: string) => createFn({ data: { periodMonth: period } }),
    onSuccess: (res) => {
      setStatementId(res.statement.id as string);
      setPeriodMonth(String(res.statement.period_month).slice(0, 10));
      qc.invalidateQueries({ queryKey: ["network-statement-months"] });
      toast.success(res.created ? "Month opened" : "Month loaded");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not open month"),
  });

  const parse = useMutation({
    mutationFn: (text: string) =>
      parseFn({
        data: { statementId: statementId!, rawText: text },
      }),
    onSuccess: (res) => {
      toast.success(`Parsed ${res.lineCount} line(s)`);
      qc.invalidateQueries({ queryKey: ["network-statement-detail", statementId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Parse failed"),
  });

  const lines = detailQ.data?.lines ?? [];
  const statement = detailQ.data?.statement;
  const status = statement?.status as string | undefined;
  const locked = status === "validated" || status === "locked";
  const refreshDetail = () =>
    qc.invalidateQueries({ queryKey: ["network-statement-detail", statementId] });
  const errorToast = (fallback: string) => (e: unknown) =>
    toast.error(e instanceof Error ? e.message : fallback);

  const onFileChosen = async (file: File | null) => {
    if (!file || !statementId || locked) return;
    try {
      const text = await readStatementFile(file);
      setRawText(text);
      setFileName(file.name);
      toast.message(`Loaded ${file.name} — parsing with AI…`);
      parse.mutate(text);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not read file");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const allocate = useMutation({
    mutationFn: (lineId: string) =>
      allocateFn({
        data: {
          lineId,
          sessionId: sessionByLine[lineId] || undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.created
          ? `Allocated as a draft fee on the customer case (fee date ${res.feeEventDate})`
          : "Already allocated to this case",
      );
      refreshDetail();
    },
    onError: errorToast("Allocate failed"),
  });

  const deallocate = useMutation({
    mutationFn: (lineId: string) =>
      deallocateFn({ data: { lineId, reason: reasonByLine[lineId] ?? "" } }),
    onSuccess: () => {
      toast.success("Deallocated — the draft fee was voided");
      refreshDetail();
    },
    onError: errorToast("Deallocate failed"),
  });

  const skip = useMutation({
    mutationFn: (v: { lineId: string; skip: boolean }) =>
      skipFn({
        data: { lineId: v.lineId, skip: v.skip, reason: reasonByLine[v.lineId] || undefined },
      }),
    onSuccess: (res) => {
      toast.success(res.status === "skipped" ? "Line skipped" : "Skip removed");
      refreshDetail();
    },
    onError: errorToast("Could not update skip"),
  });

  const lineDate = useMutation({
    mutationFn: (lineId: string) =>
      lineDateFn({ data: { lineId, transactionDate: dateByLine[lineId] || null } }),
    onSuccess: () => {
      toast.success("Transaction date saved");
      refreshDetail();
    },
    onError: errorToast("Could not save the date"),
  });

  const confirmReceived = useMutation({
    mutationFn: () =>
      receivedFn({
        data: {
          statementId: statementId!,
          receivedDate,
          confirmed: true,
          evidence: receivedEvidence || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Received date confirmed");
      setReceivedConfirmed(false);
      refreshDetail();
    },
    onError: errorToast("Could not confirm the received date"),
  });

  const saveDeclared = useMutation({
    mutationFn: () =>
      declaredFn({
        data: {
          statementId: statementId!,
          declaredTotalPence: Math.round(Number(declaredPounds) * 100),
        },
      }),
    onSuccess: () => {
      toast.success("Declared total saved");
      refreshDetail();
    },
    onError: errorToast("Could not save the declared total"),
  });

  const annotate = useMutation({
    mutationFn: (lineId: string) =>
      annotateFn({ data: { lineId, annotation: noteByLine[lineId] ?? "" } }),
    onSuccess: () => {
      toast.success("Annotation saved");
      qc.invalidateQueries({ queryKey: ["network-statement-detail", statementId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not annotate"),
  });

  const validate = useMutation({
    mutationFn: (action: "validate" | "unlock") =>
      validateFn({
        data: {
          statementId: statementId!,
          action,
          reason: action === "unlock" ? unlockReason : undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.status === "validated" ? "Statement validated" : "Statement unlocked");
      setUnlockReason("");
      qc.invalidateQueries({ queryKey: ["network-statement-detail", statementId] });
      qc.invalidateQueries({ queryKey: ["network-statement-months"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Validation failed"),
  });

  const totals = useMemo(() => {
    const received = lines.reduce((s, l) => s + Number(l.amount_received_pence ?? 0), 0);
    const allocated = lines
      .filter((l) => l.allocation_status === "allocated")
      .reduce((s, l) => s + Number(l.amount_received_pence ?? 0), 0);
    const unmatched = lines.filter((l) => l.allocation_status === "unmatched").length;
    const declared =
      statement?.declared_total_pence == null ? null : Number(statement.declared_total_pence);
    return { received, allocated, unmatched, declared };
  }, [lines, statement]);

  if (monthsQ.data?.migrationRequired) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Run <code className="text-xs">supabase/RUN_NETWORK_COMMISSION.sql</code> in the Supabase SQL
        Editor to enable network statements.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-6 space-y-3">
        <div>
          <h3 className="font-semibold text-lg">Network statements</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Upload a monthly network commission file. AI extracts lines, you allocate them onto
            customer cases as draft fees, then validate the month once every line is allocated or
            skipped and the declared total reconciles. Each fee is dated from its line transaction
            date, or the confirmed statement received date. Posting is not available yet.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="space-y-1 flex-1">
            <Label>Month</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={effectivePeriod}
              onChange={(e) => setPeriodMonth(e.target.value)}
            >
              {(monthsQ.data?.months ?? []).map((m) => (
                <option key={m.periodMonth} value={m.periodMonth}>
                  {m.label}
                  {m.status ? ` · ${m.status}` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!effectivePeriod || openMonth.isPending}
            onClick={() => openMonth.mutate(effectivePeriod)}
          >
            {openMonth.isPending ? "Opening…" : "Open month"}
          </Button>
        </div>
      </div>

      {statementId && (
        <>
          <div className="rounded-2xl border bg-card p-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-medium">Statement upload</h4>
                <p className="text-xs text-muted-foreground">
                  Status: <span className="capitalize">{status ?? "draft"}</span>
                  {fileName ? ` · Last file: ${fileName}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!locked && (
                  <Button
                    variant="outline"
                    disabled={validate.isPending}
                    onClick={() => validate.mutate("validate")}
                  >
                    Validate month
                  </Button>
                )}
                {locked && (
                  <>
                    <Input
                      className="w-64"
                      placeholder="Reason for unlocking (Owner only)"
                      value={unlockReason}
                      onChange={(e) => setUnlockReason(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={validate.isPending || unlockReason.trim().length === 0}
                      onClick={() => validate.mutate("unlock")}
                    >
                      Unlock
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 rounded-lg border p-3">
              <div className="space-y-2">
                <Label htmlFor="network-received-date">Statement received date</Label>
                <p className="text-xs text-muted-foreground">
                  {statement?.received_date
                    ? `Confirmed: ${statement.received_date}`
                    : "Not confirmed. Used only for lines without their own transaction date."}
                </p>
                {!locked && (
                  <>
                    <Input
                      id="network-received-date"
                      type="date"
                      value={receivedDate}
                      onChange={(e) => setReceivedDate(e.target.value)}
                    />
                    <Input
                      placeholder="Evidence (e.g. network email of 3 Nov)"
                      value={receivedEvidence}
                      onChange={(e) => setReceivedEvidence(e.target.value)}
                    />
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={receivedConfirmed}
                        onCheckedChange={(v) => setReceivedConfirmed(v === true)}
                      />
                      I confirm this is the date the statement was received from the network
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!receivedDate || !receivedConfirmed || confirmReceived.isPending}
                      onClick={() => confirmReceived.mutate()}
                    >
                      Confirm received date
                    </Button>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="network-declared-total">Declared statement total (£)</Label>
                <p className="text-xs text-muted-foreground">
                  {totals.declared == null
                    ? "Not set. Required before validation."
                    : `Declared: ${pounds(totals.declared)}`}
                </p>
                {!locked && (
                  <>
                    <Input
                      id="network-declared-total"
                      type="number"
                      min="0"
                      step="0.01"
                      value={declaredPounds}
                      onChange={(e) => setDeclaredPounds(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        declaredPounds.trim() === "" ||
                        !(Number(declaredPounds) >= 0) ||
                        saveDeclared.isPending
                      }
                      onClick={() => saveDeclared.mutate()}
                    >
                      Save declared total
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="network-statement-file">Upload CSV or TXT</Label>
              <Input
                id="network-statement-file"
                ref={fileRef}
                type="file"
                accept={ACCEPT_TYPES}
                disabled={locked || parse.isPending}
                onChange={(e) => void onFileChosen(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Prefer CSV export from the network. Excel/PDF: save or export as CSV/TXT first.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={locked || parse.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {parse.isPending ? "Reading with AI…" : "Choose file"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowPaste((v) => !v)}>
                {showPaste ? "Hide paste option" : "Paste text instead"}
              </Button>
            </div>

            {showPaste && (
              <>
                <Textarea
                  rows={8}
                  disabled={locked}
                  placeholder="Optional: paste statement text if you do not have a file…"
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setFileName(null);
                  }}
                />
                <Button
                  disabled={locked || rawText.trim().length < 20 || parse.isPending}
                  onClick={() => parse.mutate(rawText)}
                >
                  {parse.isPending ? "Reading with AI…" : "Parse pasted text"}
                </Button>
              </>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-6 space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                Declared <strong>{totals.declared == null ? "—" : pounds(totals.declared)}</strong>
              </span>
              <span>
                Lines total <strong>{pounds(totals.received)}</strong>
              </span>
              <span>
                Allocated <strong>{pounds(totals.allocated)}</strong>
              </span>
              <span>
                Unmatched <strong>{totals.unmatched}</strong>
              </span>
            </div>

            {detailQ.isLoading && <p className="text-sm text-muted-foreground">Loading lines…</p>}

            {!detailQ.isLoading && lines.length === 0 && (
              <p className="text-sm text-muted-foreground">No lines yet — upload a statement file.</p>
            )}

            <ul className="space-y-3">
              {lines.map((line) => {
                const id = line.id as string;
                const feeLabel =
                  FEE_TYPE_LABELS[line.fee_type as keyof typeof FEE_TYPE_LABELS] ?? line.fee_type;
                return (
                  <li key={id} className="rounded-lg border p-3 space-y-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <div className="font-medium">
                          {line.customer_name || "Unknown customer"} · {feeLabel} ·{" "}
                          {pounds(Number(line.amount_received_pence ?? 0))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {line.case_ref ? `Ref ${line.case_ref} · ` : ""}
                          {line.customer_email ?? ""}
                          {line.network_product ? ` · ${line.network_product}` : ""}
                          {" · "}
                          <span className="capitalize">{line.allocation_status}</span>
                          {line.skip_reason ? ` (${line.skip_reason})` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {line.transaction_date
                            ? `Transaction date ${line.transaction_date}${
                                line.transaction_date_source === "statement_parser"
                                  ? " (from statement, provisional until validated)"
                                  : " (entered by staff)"
                              }`
                            : "No transaction date — the confirmed received date will be used"}
                        </div>
                      </div>
                    </div>
                    {!locked && line.allocation_status !== "allocated" && (
                      <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                        <div className="space-y-1">
                          <Label className="text-xs">Transaction date</Label>
                          <Input
                            type="date"
                            value={dateByLine[id] ?? line.transaction_date ?? ""}
                            onChange={(e) =>
                              setDateByLine((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={lineDate.isPending || dateByLine[id] === undefined}
                          onClick={() => lineDate.mutate(id)}
                        >
                          Save date
                        </Button>
                      </div>
                    )}
                    {!locked && (
                      <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                        <Input
                          placeholder={
                            line.allocation_status === "allocated"
                              ? "Reason for deallocating"
                              : "Reason for skipping"
                          }
                          value={reasonByLine[id] ?? ""}
                          onChange={(e) =>
                            setReasonByLine((prev) => ({ ...prev, [id]: e.target.value }))
                          }
                        />
                        {line.allocation_status === "allocated" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={deallocate.isPending || !reasonByLine[id]?.trim()}
                            onClick={() => deallocate.mutate(id)}
                          >
                            Deallocate
                          </Button>
                        ) : line.allocation_status === "skipped" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={skip.isPending}
                            onClick={() => skip.mutate({ lineId: id, skip: false })}
                          >
                            Unskip
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={skip.isPending || !reasonByLine[id]?.trim()}
                            onClick={() => skip.mutate({ lineId: id, skip: true })}
                          >
                            Skip line
                          </Button>
                        )}
                      </div>
                    )}
                    {!locked &&
                      line.allocation_status !== "allocated" &&
                      line.allocation_status !== "skipped" && (
                        <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                          <div className="space-y-1">
                            <Label className="text-xs">Session ID (optional if auto-matched)</Label>
                            <Input
                              placeholder={
                                line.matched_session_id
                                  ? `Matched ${String(line.matched_session_id).slice(0, 8)}…`
                                  : "Paste interview session UUID"
                              }
                              value={sessionByLine[id] ?? ""}
                              onChange={(e) =>
                                setSessionByLine((prev) => ({ ...prev, [id]: e.target.value }))
                              }
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={allocate.isPending}
                            onClick={() => allocate.mutate(id)}
                          >
                            Allocate
                          </Button>
                        </div>
                      )}
                    <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                      <Input
                        placeholder="Annotation"
                        disabled={locked}
                        defaultValue={line.annotation ?? ""}
                        onChange={(e) =>
                          setNoteByLine((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                      />
                      {!locked && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={annotate.isPending}
                          onClick={() => annotate.mutate(id)}
                        >
                          Save note
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
