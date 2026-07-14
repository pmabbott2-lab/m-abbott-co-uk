import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  resolveUkAddressId,
  searchUkAddresses,
} from "@/lib/address-lookup.server";

export const searchAddresses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().min(3).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const suggestions = await searchUkAddresses(data.query);
    return { suggestions, enabled: Boolean(process.env.GETADDRESS_API_KEY) };
  });

export const resolveAddressSuggestion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const formatted = await resolveUkAddressId(data.id);
    if (!formatted) throw new Error("Could not resolve address");
    return { formatted };
  });
