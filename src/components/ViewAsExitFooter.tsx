import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

type ViewAsExitFooterProps = {
  label: string;
  onExit: () => void;
};

export function ViewAsExitFooter({ label, onExit }: ViewAsExitFooterProps) {
  return (
    <div className="pt-4 border-t flex justify-center">
      <Button variant="outline" size="lg" onClick={onExit} className="w-full sm:w-auto">
        <X className="w-4 h-4 mr-2" />
        {label}
      </Button>
    </div>
  );
}
