import { createFileRoute } from "@tanstack/react-router";
import { CreateCompanyWizard } from "@/components/company/CreateCompanyWizard";

export const Route = createFileRoute("/_authenticated/companies")({
  component: CompaniesPage,
});

export function CompaniesPage() {
  return <CreateCompanyWizard />;
}
