import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { resolveAddressSuggestion, searchAddresses } from "@/lib/address.functions";
import { cn } from "@/lib/utils";

type AddressSearchInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function AddressSearchInput({
  id,
  value,
  onChange,
  placeholder = "Start typing an address…",
}: AddressSearchInputProps) {
  const searchFn = useServerFn(searchAddresses);
  const resolveFn = useServerFn(resolveAddressSuggestion);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchQ = useQuery({
    queryKey: ["address-search", value],
    queryFn: () => searchFn({ data: { query: value } }),
    enabled: open && value.trim().length >= 3,
    staleTime: 30_000,
  });

  const suggestions = searchQ.data?.suggestions ?? [];
  const lookupEnabled = searchQ.data?.enabled ?? false;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function pickSuggestion(suggestionId: string, label: string) {
    setResolving(true);
    setOpen(false);
    try {
      const result = await resolveFn({ data: { id: suggestionId } });
      onChange(result.formatted);
    } catch {
      onChange(label);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        disabled={resolving}
      />
      {!lookupEnabled && value.length >= 3 && (
        <p className="text-xs text-muted-foreground">
          Address search is unavailable — enter the full address manually.
        </p>
      )}
      {open && lookupEnabled && value.trim().length >= 3 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
          {searchQ.isLoading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
          )}
          {!searchQ.isLoading && suggestions.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No addresses found.</p>
          )}
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-muted/80 border-b last:border-b-0",
              )}
              onClick={() => pickSuggestion(s.id, s.label)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
