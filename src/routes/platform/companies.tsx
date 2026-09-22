import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/platform/companies")({
  component: PlatformCompaniesLayout,
});

function PlatformCompaniesLayout() {
  return <Outlet />;
}
