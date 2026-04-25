import { PayrollEmployeePage } from "@/components/payroll-admin";

export default function AdminPayrollEmployeePage({
  params,
  searchParams,
}: {
  params: { employeeId: string };
  searchParams?: { start?: string; end?: string };
}) {
  const today = new Date();
  const fallbackStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const fallbackEnd = today.toISOString().slice(0, 10);

  return (
    <PayrollEmployeePage
      employeeId={params.employeeId}
      initialStart={searchParams?.start || fallbackStart}
      initialEnd={searchParams?.end || fallbackEnd}
    />
  );
}

