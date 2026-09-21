import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, type ComponentProps } from "react";
import { remapAppNavigate } from "@/lib/tenant-app-nav";
import { useTenantUi } from "@/lib/tenant-ui";

type TenantAppLinkProps = Omit<ComponentProps<typeof Link>, "to" | "params"> & {
  to: string;
  params?: Record<string, string>;
};

/**
 * Drop-in Link that stays inside `/{slug}/...` when TenantUiProvider is active.
 * Platform routes are unchanged when there is no tenant context.
 */
export function TenantAppLink({ to, params, ...rest }: TenantAppLinkProps) {
  const tenant = useTenantUi();
  const remapped = remapAppNavigate({
    to,
    params,
    tenantSlug: tenant?.slug,
  });
  return <Link {...rest} to={remapped.to as never} params={remapped.params as never} />;
}

export function useTenantAwareNavigate() {
  const navigate = useNavigate();
  const tenant = useTenantUi();
  return useCallback(
    (opts: {
      to: string;
      params?: Record<string, string>;
      search?: Record<string, unknown>;
      replace?: boolean;
    }) => {
      const remapped = remapAppNavigate({
        to: opts.to,
        params: opts.params,
        tenantSlug: tenant?.slug,
      });
      return navigate({
        to: remapped.to,
        params: remapped.params,
        search: opts.search,
        replace: opts.replace,
      } as never);
    },
    [navigate, tenant?.slug],
  );
}
