import { adminSupabase } from "@/lib/admin-server";
import { calculateShiftCompensation, loadPayrollRules } from "@/lib/payroll-rules";

export type PayrollSummaryRow = {
  employeeId: string;
  fullName: string;
  email: string;
  hourlyRate: number;
  workedMinutes: number;
  grossAmount: number;
  bonusesAmount: number;
  deductionsAmount: number;
  totalDue: number;
  paidAmount: number;
  balanceAmount: number;
};

export type PayrollPaymentRow = {
  id: string;
  employeeId: string;
  fullName: string;
  paymentDate: string;
  paymentType: "advance" | "salary";
  amount: number;
  comment: string | null;
  createdAt: string;
};

export type PayrollEmployeeDetail = {
  employee: {
    id: string;
    fullName: string;
    email: string;
    hourlyRate: number;
  };
  summary: PayrollSummaryRow;
  shifts: Array<{
    id: string;
    shiftDate: string;
    startedAt: string;
    endedAt: string | null;
    durationMinutes: number;
    status: string;
  }>;
  payments: PayrollPaymentRow[];
  adjustments: Array<{
    id: string;
    effectiveDate: string;
    kind: "bonus" | "deduction";
    amount: number;
    reason: string | null;
    createdAt: string;
  }>;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function buildPayrollSummary(periodStart: string, periodEnd: string) {
  const [rules, employeesResult, shiftsResult, paymentsResult, adjustmentsResult, rateHistoryResult, ledgerResult] = await Promise.all([
    loadPayrollRules(),
    adminSupabase
      .from("profiles")
      .select("id, full_name, email, is_active, employee_settings(hourly_rate)")
      .eq("role", "employee")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    adminSupabase
      .from("shifts")
      .select("id, employee_id, shift_date, started_at, ended_at, duration_minutes, status")
      .eq("status", "closed")
      .gte("shift_date", periodStart)
      .lte("shift_date", periodEnd)
      .order("started_at", { ascending: false }),
    adminSupabase
      .from("salary_payments")
      .select("id, employee_id, payment_date, payment_type, amount, comment, created_at, profiles!salary_payments_employee_id_fkey(full_name)")
      .gte("payment_date", periodStart)
      .lte("payment_date", periodEnd)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("pay_adjustments")
      .select("employee_id, amount, kind, reason, effective_date")
      .gte("effective_date", periodStart)
      .lte("effective_date", periodEnd),
    adminSupabase
      .from("employee_hourly_rates")
      .select("employee_id, hourly_rate, effective_from")
      .order("effective_from", { ascending: true }),
    adminSupabase
      .from("financial_ledger_entries")
      .select("employee_id, entry_type, amount, occurred_on")
      .gte("occurred_on", periodStart)
      .lte("occurred_on", periodEnd),
  ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);
  if (rateHistoryResult.error) throw new Error(rateHistoryResult.error.message);
  if (ledgerResult.error) throw new Error(ledgerResult.error.message);

  const rows = new Map<string, PayrollSummaryRow>();
  const paymentFallbacks = new Map<string, number>();
  const ratesByEmployee = new Map<
    string,
    Array<{
      effectiveFrom: string;
      hourlyRate: number;
    }>
  >();

  for (const employee of employeesResult.data ?? []) {
    const hourlyRate = numeric(
      relationFirst(
        employee.employee_settings as Array<{ hourly_rate: number }> | { hourly_rate: number } | null
      )?.hourly_rate
    );
    rows.set(employee.id, {
      employeeId: employee.id,
      fullName: employee.full_name ?? "Працівник",
      email: employee.email ?? "",
      hourlyRate,
      workedMinutes: 0,
      grossAmount: 0,
      bonusesAmount: 0,
      deductionsAmount: 0,
      totalDue: 0,
      paidAmount: 0,
      balanceAmount: 0,
    });
  }

  for (const rate of rateHistoryResult.data ?? []) {
    const list = ratesByEmployee.get(rate.employee_id) ?? [];
    list.push({
      effectiveFrom: String(rate.effective_from),
      hourlyRate: numeric(rate.hourly_rate),
    });
    ratesByEmployee.set(rate.employee_id, list);
  }

  for (const row of rows.values()) {
    if (row.hourlyRate > 0) continue;
    const rates = ratesByEmployee.get(row.employeeId) ?? [];
    const latest = rates[rates.length - 1];
    if (latest) {
      row.hourlyRate = latest.hourlyRate;
    }
  }

  for (const shift of shiftsResult.data ?? []) {
    const row = rows.get(shift.employee_id);
    if (!row) continue;
    const minutes = Math.max(0, Math.floor(numeric(shift.duration_minutes)));
    const rates = ratesByEmployee.get(shift.employee_id) ?? [];
    const shiftStartedAt = String(shift.started_at);
    let shiftRate = row.hourlyRate;
    for (const candidate of rates) {
      if (candidate.effectiveFrom <= shiftStartedAt) {
        shiftRate = candidate.hourlyRate;
      }
    }
    const compensation = calculateShiftCompensation({
      startedAt: shiftStartedAt,
      endedAt: shift.ended_at ? String(shift.ended_at) : null,
      durationMinutes: minutes,
      hourlyRate: shiftRate,
      settings: rules.settings,
      breakPolicies: rules.breakPolicies,
    });
    row.workedMinutes += compensation.payableMinutes;
    row.grossAmount += compensation.grossAmount;
  }

  for (const adjustment of adjustmentsResult.data ?? []) {
    const row = rows.get(adjustment.employee_id);
    if (!row) continue;
    const amount = Math.abs(numeric(adjustment.amount));
    if (adjustment.kind === "bonus") row.bonusesAmount += amount;
    if (adjustment.kind === "deduction") row.deductionsAmount += amount;
  }

  for (const entry of ledgerResult.data ?? []) {
    const row = rows.get(entry.employee_id);
    if (!row) continue;
    const amount = numeric(entry.amount);
    if (entry.entry_type === "bonus") row.bonusesAmount += Math.abs(amount);
    if (entry.entry_type === "penalty") row.deductionsAmount += Math.abs(amount);
    if (entry.entry_type === "advance" || entry.entry_type === "payment") {
      row.paidAmount += Math.abs(amount);
    }
  }

  for (const payment of paymentsResult.data ?? []) {
    paymentFallbacks.set(
      payment.employee_id,
      roundMoney((paymentFallbacks.get(payment.employee_id) ?? 0) + numeric(payment.amount))
    );
  }

  for (const row of rows.values()) {
    if (row.paidAmount === 0) {
      row.paidAmount = paymentFallbacks.get(row.employeeId) ?? 0;
    }
  }

  for (const row of rows.values()) {
    row.bonusesAmount = roundMoney(row.bonusesAmount);
    row.deductionsAmount = roundMoney(row.deductionsAmount);
    row.paidAmount = roundMoney(row.paidAmount);
    row.totalDue = roundMoney(row.grossAmount + row.bonusesAmount - row.deductionsAmount);
    row.balanceAmount = roundMoney(row.totalDue - row.paidAmount);
  }

  const payments: PayrollPaymentRow[] = (paymentsResult.data ?? []).map((payment: any) => ({
    id: String(payment.id),
    employeeId: String(payment.employee_id),
    fullName: String(payment.profiles?.full_name ?? "Працівник"),
    paymentDate: String(payment.payment_date),
    paymentType: payment.payment_type === "advance" ? "advance" : "salary",
    amount: numeric(payment.amount),
    comment: payment.comment ?? null,
    createdAt: String(payment.created_at),
  }));

  return {
    rows: Array.from(rows.values()).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    payments,
    totals: {
      totalWorkedMinutes: Array.from(rows.values()).reduce((sum, row) => sum + row.workedMinutes, 0),
      totalGrossAmount: roundMoney(Array.from(rows.values()).reduce((sum, row) => sum + row.grossAmount, 0)),
      totalPaidAmount: roundMoney(Array.from(rows.values()).reduce((sum, row) => sum + row.paidAmount, 0)),
      totalBalanceAmount: roundMoney(Array.from(rows.values()).reduce((sum, row) => sum + row.balanceAmount, 0)),
    },
  };
}

export async function buildPayrollEmployeeDetail(
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<PayrollEmployeeDetail> {
  const [rules, profileResult, shiftsResult, paymentsResult, adjustmentsResult] = await Promise.all([
    loadPayrollRules(),
    adminSupabase
      .from("profiles")
      .select("id, full_name, email, employee_settings(hourly_rate)")
      .eq("id", employeeId)
      .single(),
    adminSupabase
      .from("shifts")
      .select("id, shift_date, started_at, ended_at, duration_minutes, status")
      .eq("employee_id", employeeId)
      .gte("shift_date", periodStart)
      .lte("shift_date", periodEnd)
      .order("started_at", { ascending: false }),
    adminSupabase
      .from("salary_payments")
      .select("id, employee_id, payment_date, payment_type, amount, comment, created_at")
      .eq("employee_id", employeeId)
      .gte("payment_date", periodStart)
      .lte("payment_date", periodEnd)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("pay_adjustments")
      .select("id, effective_date, kind, amount, reason, created_at")
      .eq("employee_id", employeeId)
      .gte("effective_date", periodStart)
      .lte("effective_date", periodEnd)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);

  const summaryResult = await buildPayrollSummary(periodStart, periodEnd);
  const summary = summaryResult.rows.find((row) => row.employeeId === employeeId);
  if (!summary) {
    throw new Error("Працівника не знайдено у зарплатній вибірці.");
  }

  return {
    employee: {
      id: String(profileResult.data.id),
      fullName: String(profileResult.data.full_name ?? "Працівник"),
      email: String(profileResult.data.email ?? ""),
      hourlyRate:
        summary.hourlyRate ||
        numeric(
          relationFirst(
            profileResult.data.employee_settings as Array<{ hourly_rate: number }> | { hourly_rate: number } | null
          )?.hourly_rate
        ),
    },
    summary,
    shifts: (shiftsResult.data ?? []).map((shift) => {
      const compensation = calculateShiftCompensation({
        startedAt: String(shift.started_at),
        endedAt: shift.ended_at ? String(shift.ended_at) : null,
        durationMinutes: Math.max(0, Math.floor(numeric(shift.duration_minutes))),
        hourlyRate: summary.hourlyRate,
        settings: rules.settings,
        breakPolicies: rules.breakPolicies,
      });

      return {
        id: String(shift.id),
        shiftDate: String(shift.shift_date),
        startedAt: String(shift.started_at),
        endedAt: shift.ended_at ? String(shift.ended_at) : null,
        durationMinutes: compensation.payableMinutes,
        status: String(shift.status),
      };
    }),
    payments: (paymentsResult.data ?? []).map((payment) => ({
      id: String(payment.id),
      employeeId: String(payment.employee_id),
      fullName: String(profileResult.data.full_name ?? "Працівник"),
      paymentDate: String(payment.payment_date),
      paymentType: payment.payment_type === "advance" ? "advance" : "salary",
      amount: numeric(payment.amount),
      comment: payment.comment ?? null,
      createdAt: String(payment.created_at),
    })),
    adjustments: (adjustmentsResult.data ?? []).map((adjustment) => ({
      id: String(adjustment.id),
      effectiveDate: String(adjustment.effective_date),
      kind: adjustment.kind === "bonus" ? "bonus" : "deduction",
      amount: numeric(adjustment.amount),
      reason: adjustment.reason ?? null,
      createdAt: String(adjustment.created_at),
    })),
  };
}
