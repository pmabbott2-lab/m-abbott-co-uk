import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/platform/admins")({
  component: PlatformAdminsPage,
});

function PlatformAdminsPage() {
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Admins</h2>
      <p className="text-sm text-muted-foreground">
        Platform administrator management is not yet enabled. Super Admin grants will be available in
        a later phase.
      </p>
      <p className="text-sm text-muted-foreground">
        This page does not create platform roles or tenant grants.
      </p>
    </div>
  );
}
