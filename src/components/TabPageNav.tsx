import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { TenantAppLink } from "@/components/tenant/TenantAppLink";
import { useTenantUi } from "@/lib/tenant-ui";

type TabPageNavProps = {
  backTo?: string;
  backLabel?: string;
  onBack?: () => void;
};

export function TabPageNav({
  backTo = "/home",
  backLabel = "Back",
  onBack,
}: TabPageNavProps) {
  const navigate = useNavigate();
  const tenant = useTenantUi();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({
      to: "/auth",
      search: tenant ? { tenant: tenant.slug } : {},
      replace: true,
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b">
      {onBack ? (
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          {backLabel}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" asChild>
          <TenantAppLink to={backTo}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            {backLabel}
          </TenantAppLink>
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => void signOut()} className="text-muted-foreground">
        <LogOut className="w-4 h-4 mr-1.5" />
        Sign out
      </Button>
    </div>
  );
}
