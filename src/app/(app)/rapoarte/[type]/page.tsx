import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";
import { ButtonLink, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ReportView } from "@/components/reports/report-view";
import { getPageContext, load } from "@/server/http/page";
import { auditExport, buildReport } from "@/server/reports";

export const metadata: Metadata = { title: "Raport" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ type }, sp] = await Promise.all([params, searchParams]);
  const { actor } = await getPageContext();
  const query = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string"));
  const report = await load(buildReport(actor, type, query));
  await auditExport(actor, report.type, query, "html");
  const xlsx = `/api/reports/${type}?${new URLSearchParams({ ...query, format: "xlsx" }).toString()}`;
  return (
    <>
      <div className="no-print">
      <PageHeader
        breadcrumbs={[{ label: "Rapoarte", href: "/rapoarte" }, { label: report.title }]}
        title={report.title}
        subtitle={report.subtitle}
        actions={
          <>
            <ButtonLink href={xlsx} variant="secondary" prefetch={false}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </ButtonLink>
            <PrintButton label="Tipărește / PDF" />
          </>
        }
      />
      </div>
      <ReportView report={report} />
    </>
  );
}
