import { adminSupabase } from "@/lib/admin-server";
import { calculateShiftCompensation, loadPayrollRules } from "@/lib/payroll-rules";

type BatchRow = {
  id: string;
  batchStart: string;
  batchEnd: string;
  batchLabel: string;
  quantity: number;
  unitPrice: number;
  revenueAmount: number;
  note: string | null;
};

type CostRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  category: "rent" | "utilities" | "other";
  amount: number;
  allocatedAmount: number;
  note: string | null;
};

type PayrollCostRow = {
  employeeId: string;
  fullName: string;
  workedMinutes: number;
  totalDue: number;
};

function numeric(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

const DEFAULT_MONTHLY_RENT_AMOUNT = 65000;
const DEFAULT_TAX_RATE = 0.23;
const DEFAULT_WITHDRAWAL_FEE_RATE = 0.02;

function daysInclusive(start: Date, end: Date) {
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
}

function daysInMonth(dateString: string) {
  const date = new Date(dateString);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function enumerateDates(start: string, end: string) {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00`);
  const limit = new Date(`${end}T00:00:00`);

  while (current.getTime() <= limit.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function allocateCostAmount(
  entryStart: string,
  entryEnd: string,
  queryStart: string,
  queryEnd: string,
  amount: number
) {
  const start = new Date(entryStart);
  const end = new Date(entryEnd);
  const rangeStart = new Date(queryStart);
  const rangeEnd = new Date(queryEnd);

  const overlapStart = new Date(Math.max(start.getTime(), rangeStart.getTime()));
  const overlapEnd = new Date(Math.min(end.getTime(), rangeEnd.getTime()));

  if (overlapEnd.getTime() < overlapStart.getTime()) {
    return 0;
  }

  const totalDays = daysInclusive(start, end);
  const overlapDays = daysInclusive(overlapStart, overlapEnd);
  return roundMoney((amount / totalDays) * overlapDays);
}

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function buildProfitabilitySnapshot(periodStart: string, periodEnd: string) {
  const [rules, settingsResult, employeesResult, rateHistoryResult, shiftsResult, batchesResult, costsResult] = await Promise.all([
    loadPayrollRules(),
    adminSupabase.from("company_settings").select("profitability_monthly_rent_amount, profitability_tax_rate, profitability_withdrawal_fee_rate").eq("singleton_key", "default").maybeSingle(),
    adminSupabase
      .from("profiles")
      .select("id, full_name, employee_settings(hourly_rate)")
      .eq("role", "employee")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    adminSupabase
      .from("employee_hourly_rates")
      .select("employee_id, hourly_rate, effective_from")
      .order("effective_from", { ascending: true }),
    adminSupabase
      .from("shifts")
      .select("employee_id, shift_date, started_at, ended_at, duration_minutes, status")
      .eq("status", "closed")
      .gte("shift_date", periodStart)
      .lte("shift_date", periodEnd),
    adminSupabase
      .from("production_batches")
      .select("id, batch_start, batch_end, work_date, batch_label, quantity, unit_price, note")
      .or(`and(batch_start.lte.${periodEnd},batch_end.gte.${periodStart}),and(work_date.gte.${periodStart},work_date.lte.${periodEnd})`)
      .order("batch_start", { ascending: false, nullsFirst: false })
      .order("work_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("operating_cost_entries")
      .select("id, period_start, period_end, category, amount, note")
      .lte("period_start", periodEnd)
      .gte("period_end", periodStart)
      .order("period_start", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (rateHistoryResult.error) throw new Error(rateHistoryResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);
  if (batchesResult.error) throw new Error(batchesResult.error.message);
  if (costsResult.error) throw new Error(costsResult.error.message);

  const monthlyRentAmount = numeric(settingsResult.data?.profitability_monthly_rent_amount) || DEFAULT_MONTHLY_RENT_AMOUNT;
  const taxRate = numeric(settingsResult.data?.profitability_tax_rate) || DEFAULT_TAX_RATE;
  const withdrawalFeeRate =
    numeric(settingsResult.data?.profitability_withdrawal_fee_rate) || DEFAULT_WITHDRAWAL_FEE_RATE;

  const batches: BatchRow[] = (batchesResult.data ?? []).map((row: any) => {
    const quantity = numeric(row.quantity);
    const unitPrice = numeric(row.unit_price);
    const singleDay = String(row.work_date ?? row.batch_start ?? row.batch_end);
    const batchStart = String(row.batch_start ?? singleDay);
    const batchEnd = String(row.batch_end ?? singleDay);
    return {
      id: String(row.id),
      batchStart,
      batchEnd,
      batchLabel: String(row.batch_label ?? "Партія"),
      quantity,
      unitPrice,
      revenueAmount: roundMoney(quantity * unitPrice),
      note: row.note ?? null,
    };
  });

  const coveredBatchDates = new Set<string>();
  for (const batch of batches) {
    for (const date of enumerateDates(batch.batchStart, batch.batchEnd)) {
      if (date >= periodStart && date <= periodEnd) {
        coveredBatchDates.add(date);
      }
    }
  }

  const payrollRowsMap = new Map<string, PayrollCostRow>();
  const ratesByEmployee = new Map<string, Array<{ effectiveFrom: string; hourlyRate: number }>>();

  for (const employee of employeesResult.data ?? []) {
    const hourlyRate = numeric(
      relationFirst(
        employee.employee_settings as Array<{ hourly_rate: number }> | { hourly_rate: number } | null
      )?.hourly_rate
    );
    payrollRowsMap.set(String(employee.id), {
      employeeId: String(employee.id),
      fullName: String(employee.full_name ?? "Працівник"),
      workedMinutes: 0,
      totalDue: hourlyRate > 0 ? 0 : 0,
    });
  }

  for (const rate of rateHistoryResult.data ?? []) {
    const employeeId = String(rate.employee_id);
    const list = ratesByEmployee.get(employeeId) ?? [];
    list.push({
      effectiveFrom: String(rate.effective_from),
      hourlyRate: numeric(rate.hourly_rate),
    });
    ratesByEmployee.set(employeeId, list);
  }

  const currentRateByEmployee = new Map<string, number>();
  for (const employee of employeesResult.data ?? []) {
    const employeeId = String(employee.id);
    const fallbackRate = numeric(
      relationFirst(
        employee.employee_settings as Array<{ hourly_rate: number }> | { hourly_rate: number } | null
      )?.hourly_rate
    );
    const latestRate = ratesByEmployee.get(employeeId)?.at(-1)?.hourlyRate ?? fallbackRate;
    currentRateByEmployee.set(employeeId, latestRate);
  }

  for (const shift of shiftsResult.data ?? []) {
    const shiftDate = String(shift.shift_date);
    if (!coveredBatchDates.has(shiftDate)) continue;

    const employeeId = String(shift.employee_id);
    const row = payrollRowsMap.get(employeeId);
    if (!row) continue;

    const minutes = Math.max(0, Math.floor(numeric(shift.duration_minutes)));

    const shiftStartedAt = String(shift.started_at);
    const employeeRates = ratesByEmployee.get(employeeId) ?? [];
    let shiftRate = currentRateByEmployee.get(employeeId) ?? 0;
    for (const candidate of employeeRates) {
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
    row.totalDue = roundMoney(row.totalDue + compensation.grossAmount);
  }

  const payrollRows = Array.from(payrollRowsMap.values())
    .filter((row) => row.workedMinutes > 0 || row.totalDue > 0)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "uk"));

  const costs: CostRow[] = (costsResult.data ?? []).map((row) => {
    const amount = numeric(row.amount);
    return {
      id: String(row.id),
      periodStart: String(row.period_start),
      periodEnd: String(row.period_end),
      category: row.category === "rent" ? "rent" : row.category === "utilities" ? "utilities" : "other",
      amount,
      allocatedAmount: allocateCostAmount(
        String(row.period_start),
        String(row.period_end),
        periodStart,
        periodEnd,
        amount
      ),
      note: row.note ?? null,
    };
  });

  const totalRevenue = roundMoney(batches.reduce((sum, row) => sum + row.revenueAmount, 0));
  const totalPayroll = roundMoney(payrollRows.reduce((sum, row) => sum + row.totalDue, 0));
  const automaticRentCosts = roundMoney(
    Array.from(coveredBatchDates).reduce((sum, workDate) => sum + monthlyRentAmount / daysInMonth(workDate), 0)
  );
  const utilitiesCosts = roundMoney(
    costs.filter((row) => row.category === "utilities").reduce((sum, row) => sum + row.allocatedAmount, 0)
  );
  const otherCosts = roundMoney(
    costs.filter((row) => row.category === "other").reduce((sum, row) => sum + row.allocatedAmount, 0)
  );
  const manualRentCosts = roundMoney(
    costs.filter((row) => row.category === "rent").reduce((sum, row) => sum + row.allocatedAmount, 0)
  );
  const rentCosts = roundMoney(automaticRentCosts + manualRentCosts);
  const totalTax = roundMoney(totalRevenue * taxRate);
  const withdrawalFee = roundMoney(totalRevenue * withdrawalFeeRate);
  const totalOperatingCosts = roundMoney(rentCosts + utilitiesCosts + otherCosts + totalTax + withdrawalFee);
  const grossMargin = roundMoney(totalRevenue - totalPayroll - totalOperatingCosts);
  const marginRate = totalRevenue > 0 ? Math.round((grossMargin / totalRevenue) * 1000) / 10 : 0;

  return {
    periodStart,
    periodEnd,
    summary: {
      totalRevenue,
      totalPayroll,
      totalOperatingCosts,
      rentCosts,
      utilitiesCosts,
      otherCosts,
      totalTax,
      withdrawalFee,
      automaticRentCosts,
      batchCoveredDays: coveredBatchDates.size,
      grossMargin,
      marginRate,
      batchCount: batches.length,
    },
    settings: {
      monthlyRentAmount,
      taxRate,
      withdrawalFeeRate,
    },
    payrollRows,
    batches,
    costs,
  };
}
