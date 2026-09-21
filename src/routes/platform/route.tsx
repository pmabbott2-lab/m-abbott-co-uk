import { createFileRoute } from "@tanstack/react-router";
import { PlatformLayout } from "@/components/platform/PlatformShell";

export const Route = createFileRoute("/platform")({
  ssr: false,
  component: PlatformLayout,
});
