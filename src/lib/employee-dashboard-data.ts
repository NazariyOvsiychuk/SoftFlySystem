import { adminSupabase } from "@/lib/admin-server";
import { calculateShiftCompensation, loadPayrollRules } from "@/lib/payroll-rules";

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function buildEmployeeDashboardData(employeeId: string) {
  const [rules, profileResult, scheduleResult, shiftsResult, payrollItemsResult, paymentsResult, adjustmentsResult, rateHistoryResult, violationsResult] =
    await Promise.all([
      loadPayrollRules(),
      adminSupabase
        .from("profiles")
        .select("id, full_name, email, role, employee_settings(hourly_rate)")
        .eq("id", employeeId)
        .single(),
      adminSupabase
        .from("schedule_days")
        .select("id, work_date, day_type, expected_start, expected_end")
        .eq("employee_id", employeeId)
        .order("work_date", { ascending: false })
        .limit(14),
      adminSupabase
        .from("shifts")
        .select("id, shift_date, started_at, ended_at, duration_minutes, status")
        .eq("employee_id", employeeId)
        .order("started_at", { ascending: false })
        .limit(120),
      adminSupabase
        .from("payroll_run_items")
        .select("id, worked_minutes, gross_amount, bonuses_amount, deductions_amount, total_due, paid_amount, balance_amount, snapshot, created_at, payroll_runs!inner(period_start, period_end, status, created_at)")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false }),
      adminSupabase
        .from("salary_payments")
        .select("id, payment_date, payment_type, amount, comment, created_at")
        .eq("employee_id", employeeId)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false }),
      adminSupabase
        .from("pay_adjustments")
        .select("id, effective_date, kind, amount")
        .eq("employee_id", employeeId)
        .order("effective_date", { ascending: false }),
      adminSupabase
        .from("employee_hourly_rates")
        .select("employee_id, hourly_rate, effective_from")
        .eq("employee_id", employeeId)
        .order("effective_from", { ascending: true }),
      adminSupabase
        .from("discipline_violations")
        .select("id, violation_type, violation_date, resolved")
        .eq("employee_id", employeeId)
        .order("violation_date", { ascending: false })
        .limit(10),
    ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (scheduleResult.error) throw new Error(scheduleResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);
  if (payrollItemsResult.error) throw new Error(payrollItemsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);
  if (rateHistoryResult.error) throw new Error(rateHistoryResult.error.message);
  if (violationsResult.error) throw new Error(violationsResult.error.message);

  const fallbackRate = numeric(
    relationFirst(
      profileResult.data.employee_settings as Array<{ hourly_rate: number }> | { hourly_rate: number } | null
    )?.hourly_rate
  );
  const rates = (rateHistoryResult.data ?? []).map((row) => ({
    effectiveFrom: String(row.effective_from),
    hourlyRate: numeric(row.hourly_rate),
  }));
  const latestRate = rates.at(-1)?.hourlyRate ?? fallbackRate;

  const payrollItems = (payrollItemsResult.data ?? []).map((item: any) => ({
    id: String(item.id),
    workedMinutes: Math.max(0, Math.floor(numeric(item.worked_minutes))),
    grossAmount: roundMoney(numeric(item.gross_amount)),
    bonusesAmount: roundMoney(numeric(item.bonuses_amount)),
    deductionsAmount: roundMoney(numeric(item.deductions_amount)),
    totalDue: roundMoney(numeric(item.total_due)),
    paidAmount: roundMoney(numeric(item.paid_amount)),
    balanceAmount: roundMoney(numeric(item.balance_amount)),
    snapshot: item.snapshot ?? {},
    createdAt: String(item.created_at),
    periodStart: String(item.payroll_runs?.period_start ?? ""),
    periodEnd: String(item.payroll_runs?.period_end ?? ""),
    runStatus: String(item.payroll_runs?.status ?? "draft"),
  }));

  const shifts = (shiftsResult.data ?? []).map((shift) => {
    const minutes = Math.max(0, Math.floor(numeric(shift.duration_minutes)));
    let shiftRate = latestRate;
    for (const candidate of rates) {
      if (candidate.effectiveFrom <= String(shift.started_at)) {
        shiftRate = candidate.hourlyRate;
      }
    }
    const compensation = calculateShiftCompensation({
      startedAt: String(shift.started_at),
      endedAt: shift.ended_at ? String(shift.ended_at) : null,
      durationMinutes: minutes,
      hourlyRate: shiftRate,
      settings: rules.settings,
      breakPolicies: rules.breakPolicies,
    });

    const includedInPayroll = payrollItems.some(
      (item) =>
        item.periodStart &&
        item.periodEnd &&
        String(shift.shift_date) >= item.periodStart &&
        String(shift.shift_date) <= item.periodEnd
    );

    return {
      id: String(shift.id),
      shiftDate: String(shift.shift_date),
      startedAt: String(shift.started_at),
      endedAt: shift.ended_at ? String(shift.ended_at) : null,
      durationMinutes: compensation.payableMinutes,
      status: String(shift.status),
      includedInPayroll,
      grossAmount: compensation.grossAmount,
    };
  });

  const totalWorkedMinutes = shifts
    .filter((shift) => shift.status === "closed")
    .reduce((sum, shift) => sum + shift.durationMinutes, 0);
  const payrollWorkedMinutes = payrollItems.reduce((sum, item) => sum + item.workedMinutes, 0);
  const unpaidWorkedMinutes = Math.max(0, totalWorkedMinutes - payrollWorkedMinutes);
  const shiftAccruedAmount = roundMoney(
    shifts.filter((shift) => shift.status === "closed").reduce((sum, shift) => sum + numeric((shift as any).grossAmount), 0)
  );
  const adjustmentDelta = roundMoney(
    (adjustmentsResult.data ?? []).reduce((sum, item: any) => {
      const amount = Math.abs(numeric(item.amount));
      return sum + (item.kind === "bonus" ? amount : -amount);
    }, 0)
  );
  const totalAccruedAmount = roundMoney(shiftAccruedAmount + adjustmentDelta);
  const totalPaidAmount = roundMoney((paymentsResult.data ?? []).reduce((sum, item) => sum + numeric(item.amount), 0));
  const outstandingAmount = roundMoney(totalAccruedAmount - totalPaidAmount);

  return {
    profile: {
      id: String(profileResult.data.id),
      full_name: String(profileResult.data.full_name ?? "Працівник"),
      email: String(profileResult.data.email ?? ""),
      role: "employee" as const,
    },
    schedule: (scheduleResult.data ?? []).map((row) => ({
      id: String(row.id),
      work_date: String(row.work_date),
      day_type: row.day_type,
      expected_start: row.expected_start ? String(row.expected_start) : null,
      expected_end: row.expected_end ? String(row.expected_end) : null,
    })),
    shifts,
    payrollItems,
    violations: (violationsResult.data ?? []).map((row) => ({
      id: String(row.id),
      violation_type: String(row.violation_type),
      violation_date: String(row.violation_date),
      resolved: Boolean(row.resolved),
    })),
    totals: {
      totalWorkedMinutes,
      payrollWorkedMinutes,
      unpaidWorkedMinutes,
      totalAccruedAmount,
      totalPaidAmount,
      outstandingAmount,
    },
  };
}
