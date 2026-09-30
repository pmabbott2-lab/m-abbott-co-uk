import { z } from "zod";

/**
 * Public appointment booking contract (createAppointment, createAppointmentAuth, public signup).
 * Strict: trusted relationship ids (customerId, sessionId, tenant_id) and any other unknown key
 * fail validation instead of being stripped.
 */
export const publicAppointmentInput = z
  .object({
    /** Introducer referral slug; resolved server-side to an active introducer. */
    slug: z.string().min(1).optional(),
    /** Hub tenant route slug (e.g. mortgageeasy). */
    tenantSlug: z.string().min(1).max(64).optional(),
    /** Introducer lead link; only honoured when bound to the referral introducer and tenant. */
    leadId: z.string().uuid().optional(),
    /** Must be in the resolved tenant's public bookable adviser pool. */
    advisorId: z.string().uuid().optional(),
    preferAnyAdvisor: z.boolean().optional(),
    channel: z.enum(["voice", "text", "direct_booking"]).optional(),
    customerName: z.string().min(2),
    customerPhone: z.string().min(7),
    customerEmail: z.string().email().optional().or(z.literal("")),
    startsAt: z.string().datetime(),
    notes: z.string().max(500).optional(),
    sendSms: z.boolean().optional(),
  })
  .strict();

export type PublicAppointmentInput = z.infer<typeof publicAppointmentInput>;

/**
 * Booking handed to the trusted implementation after public validation. Every relationship is
 * server-resolved; customer and session relationships cannot be expressed at all.
 */
export type PublicBookingPlan = {
  slug?: string;
  tenantSlug?: string;
  tenant_id: string;
  leadId?: string;
  advisorId?: string;
  preferAnyAdvisor?: boolean;
  channel?: "voice" | "text" | "direct_booking";
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  startsAt: string;
  notes?: string;
  sendSms?: boolean;
  customerId?: never;
  sessionId?: never;
};
