import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";
import { buildPayrollSummary } from "@/lib/payroll-admin";

export async function POST(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) {
    return NextResponse.json({ error: "Немає токена доступу." }, { status: 401 });
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  const { data: profile } = await scopedClient
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { periodStart?: string; periodEnd?: string };
  if (!body.periodStart || !body.periodEnd) {
    return NextResponse.json({ error: "Потрібні periodStart і periodEnd." }, { status: 400 });
  }

  try {
    const summary = await buildPayrollSummary(body.periodStart, body.periodEnd);
    const { data: run, error: runError } = await adminSupabase
      .from("payroll_runs")
      .insert({
        period_start: body.periodStart,
        period_end: body.periodEnd,
        status: "draft",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();

    if (runError || !run) {
      return NextResponse.json({ error: runError?.message ?? "Не вдалося створити payroll run." }, { status: 400 });
    }

    if (summary.rows.length) {
      const { error: itemsError } = await adminSupabase.from("payroll_run_items").insert(
        summary.rows.map((row) => ({
          payroll_run_id: run.id,
          employee_id: row.employeeId,
          worked_minutes: row.workedMinutes,
          gross_amount: row.grossAmount,
          bonuses_amount: row.bonusesAmount,
          deductions_amount: row.deductionsAmount,
          total_due: row.totalDue,
          paid_amount: row.paidAmount,
          balance_amount: row.balanceAmount,
          snapshot: row,
        }))
      );

      if (itemsError) {
        return NextResponse.json({ error: itemsError.message }, { status: 400 });
      }
    }

    return NextResponse.json({ message: "Payroll run створено.", payrollRunId: run.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося створити payroll run." },
      { status: 400 }
    );
  }
}
