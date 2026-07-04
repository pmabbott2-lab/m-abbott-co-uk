import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
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
          <Link to={backTo}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            {backLabel}
          </Link>
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => void signOut()} className="text-muted-foreground">
        <LogOut className="w-4 h-4 mr-1.5" />
        Sign out
      </Button>
    </div>
  );
}
