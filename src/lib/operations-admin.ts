import { adminSupabase } from "@/lib/admin-server";

type EmployeeBase = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  employee_settings: { hourly_rate: number } | { hourly_rate: number }[] | null;
};

type ShiftBase = {
  id: string;
  employee_id: string;
  shift_date: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  status: string;
  created_at?: string;
  updated_at?: string;
};

type PaymentBase = {
  id: string;
  employee_id: string;
  payment_date: string;
  payment_type: "advance" | "salary";
  amount: number;
  comment: string | null;
};

type AdjustmentBase = {
  employee_id: string;
  amount: number;
  kind: "bonus" | "deduction";
  effective_date: string;
  reason: string;
};

type RateBase = {
  employee_id: string;
  hourly_rate: number;
  effective_from: string;
};

type ScheduleBase = {
  employee_id: string;
  work_date: string;
  expected_start: string | null;
  expected_end: string | null;
};

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function minutesBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.max(0, Math.floor((end - start) / 60000));
}

function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function eachDay(start: string, end: string) {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const stop = new Date(`${end}T00:00:00`);
  while (cursor.getTime() <= stop.getTime()) {
    out.push(toDateInputValue(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function getRateForMoment(
  employeeId: string,
  fallbackRate: number,
  moment: string,
  ratesByEmployee: Map<string, RateBase[]>
) {
  const rates = ratesByEmployee.get(employeeId) ?? [];
  let rate = fallbackRate;
  for (const item of rates) {
    if (item.effective_from <= moment) {
      rate = numeric(item.hourly_rate);
    }
  }
  return rate;
}

async function fetchRateHistory() {
  const result = await adminSupabase
    .from("employee_hourly_rates")
    .select("employee_id, hourly_rate, effective_from")
    .order("effective_from", { ascending: true });

  if (result.error) {
    return [] as RateBase[];
  }
  return (result.data ?? []) as RateBase[];
}

async function fetchCoreRange(periodStart: string, periodEnd: string) {
  const today = toDateInputValue(new Date());
  const [employeesResult, shiftsResult, openShiftsResult, paymentsResult, adjustmentsResult, schedulesResult, rates] =
    await Promise.all([
      adminSupabase
        .from("profiles")
        .select("id, full_name, email, is_active, employee_settings(hourly_rate)")
        .eq("role", "employee")
        .order("full_name", { ascending: true }),
      adminSupabase
        .from("shifts")
        .select("id, employee_id, shift_date, started_at, ended_at, duration_minutes, status, created_at, updated_at")
        .gte("shift_date", periodStart)
        .lte("shift_date", periodEnd)
        .order("started_at", { ascending: false }),
      adminSupabase
        .from("shifts")
        .select("id, employee_id, shift_date, started_at, ended_at, duration_minutes, status, created_at, updated_at")
        .eq("status", "open")
        .order("started_at", { ascending: true }),
      adminSupabase
        .from("salary_payments")
        .select("id, employee_id, payment_date, payment_type, amount, comment")
        .gte("payment_date", periodStart)
        .lte("payment_date", periodEnd)
        .order("payment_date", { ascending: true }),
      adminSupabase
        .from("pay_adjustments")
        .select("employee_id, amount, kind, effective_date, reason")
        .gte("effective_date", periodStart)
        .lte("effective_date", periodEnd),
      adminSupabase
        .from("schedule_days")
        .select("employee_id, work_date, expected_start, expected_end")
        .gte("work_date", periodStart)
        .lte("work_date", periodEnd),
      fetchRateHistory(),
    ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);
  if (openShiftsResult.error) throw new Error(openShiftsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);
  if (schedulesResult.error) throw new Error(schedulesResult.error.message);

  const employees = (employeesResult.data ?? []) as EmployeeBase[];
  const shifts = (shiftsResult.data ?? []) as ShiftBase[];
  const openShifts = (openShiftsResult.data ?? []) as ShiftBase[];
  const payments = (paymentsResult.data ?? []) as PaymentBase[];
  const adjustments = (adjustmentsResult.data ?? []) as AdjustmentBase[];
  const schedules = (schedulesResult.data ?? []) as ScheduleBase[];

  const employeeMap = new Map(
    employees.map((employee) => [
      employee.id,
      {
        id: employee.id,
        fullName: employee.full_name,
        email: employee.email,
        isActive: employee.is_active,
        hourlyRate: numeric(relationFirst(employee.employee_settings)?.hourly_rate),
      },
    ])
  );

  const ratesByEmployee = new Map<string, RateBase[]>();
  for (const rate of rates) {
    const list = ratesByEmployee.get(rate.employee_id) ?? [];
    list.push(rate);
    ratesByEmployee.set(rate.employee_id, list);
  }

  for (const employee of employeeMap.values()) {
    if (employee.hourlyRate > 0) continue;
    const list = ratesByEmployee.get(employee.id) ?? [];
    const latest = list[list.length - 1];
    if (latest) employee.hourlyRate = numeric(latest.hourly_rate);
  }

  return {
    today,
    employees: Array.from(employeeMap.values()),
    employeeMap,
    ratesByEmployee,
    shifts,
    openShifts,
    payments,
    adjustments,
    schedules,
  };
}

export async function buildDashboardControlCenter(periodStart: string, periodEnd: string) {
  const data = await fetchCoreRange(periodStart, periodEnd);
  const activeEmployees = data.employees.filter((employee) => employee.isActive).length;
  const todayClosedShifts = data.shifts.filter((shift) => shift.shift_date === data.today && shift.status === "closed");
  const todayStarted = data.shifts.filter((shift) => shift.started_at.slice(0, 10) === data.today).length;
  const todayEnded = data.shifts.filter((shift) => (shift.ended_at ? shift.ended_at.slice(0, 10) === data.today : false)).length;

  let todayWorkedMinutes = 0;
  let todayAccrual = 0;
  let periodAccrual = 0;
  const dailyHours = new Map<string, number>();
  const dailyPayroll = new Map<string, number>();
  const dailyActive = new Map<string, number>();

  for (const day of eachDay(periodStart, periodEnd)) {
    dailyHours.set(day, 0);
    dailyPayroll.set(day, 0);
    dailyActive.set(day, 0);
  }

  for (const shift of data.shifts.filter((item) => item.status === "closed")) {
    const employee = data.employeeMap.get(shift.employee_id);
    if (!employee) continue;
    const minutes = Math.max(0, Math.floor(numeric(shift.duration_minutes)));
    const rate = getRateForMoment(shift.employee_id, employee.hourlyRate, shift.started_at, data.ratesByEmployee);
    const accrual = roundMoney((minutes / 60) * rate);

    periodAccrual += accrual;
    dailyHours.set(shift.shift_date, numeric(dailyHours.get(shift.shift_date)) + minutes);
    dailyPayroll.set(shift.shift_date, roundMoney(numeric(dailyPayroll.get(shift.shift_date)) + accrual));
    dailyActive.set(shift.shift_date, numeric(dailyActive.get(shift.shift_date)) + 1);

    if (shift.shift_date === data.today) {
      todayWorkedMinutes += minutes;
      todayAccrual += accrual;
    }
  }

  let advancesAmount = 0;
  let paidAmount = 0;
  const paidByEmployee = new Map<string, number>();
  for (const payment of data.payments) {
    const amount = numeric(payment.amount);
    paidAmount += amount;
    paidByEmployee.set(payment.employee_id, roundMoney((paidByEmployee.get(payment.employee_id) ?? 0) + amount));
    if (payment.payment_type === "advance") advancesAmount += amount;
  }

  let bonusesAmount = 0;
  let deductionsAmount = 0;
  const netAdjustmentsByEmployee = new Map<string, number>();
  for (const adjustment of data.adjustments) {
    const amount = Math.abs(numeric(adjustment.amount));
    if (adjustment.kind === "bonus") {
      bonusesAmount += amount;
      netAdjustmentsByEmployee.set(
        adjustment.employee_id,
        roundMoney((netAdjustmentsByEmployee.get(adjustment.employee_id) ?? 0) + amount)
      );
    } else {
      deductionsAmount += amount;
      netAdjustmentsByEmployee.set(
        adjustment.employee_id,
        roundMoney((netAdjustmentsByEmployee.get(adjustment.employee_id) ?? 0) - amount)
      );
    }
  }

  const activeShiftRows = data.openShifts.map((shift) => {
    const employee = data.employeeMap.get(shift.employee_id);
    const startedAt = shift.started_at;
    const liveMinutes = minutesBetween(startedAt, new Date().toISOString());
    const rate = employee
      ? getRateForMoment(shift.employee_id, employee.hourlyRate, shift.started_at, data.ratesByEmployee)
      : 0;
    return {
      shiftId: shift.id,
      employeeId: shift.employee_id,
      fullName: employee?.fullName ?? "Працівник",
      startedAt,
      liveMinutes,
      liveEarnings: roundMoney((liveMinutes / 60) * rate),
      hourlyRate: rate,
    };
  });

  const grossWithAdjustments = roundMoney(periodAccrual + bonusesAmount - deductionsAmount);
  const employeesWithDebt = new Set<string>();
  for (const employee of data.employees) {
    const employeeShifts = data.shifts.filter((shift) => shift.employee_id === employee.id && shift.status === "closed");
    let employeeGross = 0;
    for (const shift of employeeShifts) {
      const rate = getRateForMoment(employee.id, employee.hourlyRate, shift.started_at, data.ratesByEmployee);
      employeeGross += roundMoney((numeric(shift.duration_minutes) / 60) * rate);
    }
    const net = employeeGross + numeric(netAdjustmentsByEmployee.get(employee.id)) - numeric(paidByEmployee.get(employee.id));
    if (net > 0) employeesWithDebt.add(employee.id);
  }

  const scheduleByEmployeeDate = new Map<string, ScheduleBase>();
  for (const schedule of data.schedules) {
    scheduleByEmployeeDate.set(`${schedule.employee_id}::${schedule.work_date}`, schedule);
  }

  const overlappingEmployeeIds = new Set<string>();
  const editedShiftIds = new Set<string>();
  const oldUnpaidEmployeeIds = new Set<string>();
  const zeroOrNegativeBalanceIds = new Set<string>();

  const shiftsByEmployee = new Map<string, ShiftBase[]>();
  for (const shift of data.shifts) {
    const list = shiftsByEmployee.get(shift.employee_id) ?? [];
    list.push(shift);
    shiftsByEmployee.set(shift.employee_id, list);

    const created = shift.created_at ? new Date(shift.created_at).getTime() : 0;
    const updated = shift.updated_at ? new Date(shift.updated_at).getTime() : 0;
    if (updated && created && updated - created > 60_000) {
      editedShiftIds.add(shift.id);
    }
  }

  for (const [employeeId, shifts] of shiftsByEmployee.entries()) {
    const sorted = [...shifts].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const current = sorted[i];
      const prevEnd = prev.ended_at ? new Date(prev.ended_at).getTime() : Number.POSITIVE_INFINITY;
      const currentStart = new Date(current.started_at).getTime();
      if (currentStart < prevEnd) {
        overlappingEmployeeIds.add(employeeId);
      }
    }
  }

  const oldThreshold = new Date();
  oldThreshold.setDate(oldThreshold.getDate() - 7);
  const oldThresholdStr = toDateInputValue(oldThreshold);

  for (const employee of data.employees) {
    const employeeShifts = data.shifts.filter((shift) => shift.employee_id === employee.id && shift.status === "closed");
    let employeeGross = 0;
    for (const shift of employeeShifts) {
      const rate = getRateForMoment(employee.id, employee.hourlyRate, shift.started_at, data.ratesByEmployee);
      employeeGross += roundMoney((numeric(shift.duration_minutes) / 60) * rate);
    }
    const net = roundMoney(
      employeeGross + numeric(netAdjustmentsByEmployee.get(employee.id)) - numeric(paidByEmployee.get(employee.id))
    );
    if (net <= 0) zeroOrNegativeBalanceIds.add(employee.id);

    const latestClosedShift = employeeShifts
      .map((shift) => shift.shift_date)
      .sort()
      .at(-1);
    if (latestClosedShift && latestClosedShift <= oldThresholdStr && net > 0) {
      oldUnpaidEmployeeIds.add(employee.id);
    }
  }

  const alerts = [
    ...activeShiftRows.map((shift) => ({
      kind: "open_shift",
      title: `${shift.fullName}: відкрита зміна`,
      description: `Початок ${shift.startedAt}. Зміна ще не закрита.`,
      href: "/admin/time",
      severity: "medium",
    })),
    ...Array.from(overlappingEmployeeIds).map((employeeId) => ({
      kind: "overlap",
      title: `${data.employeeMap.get(employeeId)?.fullName ?? "Працівник"}: перекриті зміни`,
      description: "Знайдено щонайменше дві зміни, що перекриваються у часі.",
      href: "/admin/time",
      severity: "high",
    })),
    ...Array.from(editedShiftIds).map((shiftId) => ({
      kind: "edited_shift",
      title: "Виявлено відредаговану зміну",
      description: `Зміна ${shiftId.slice(0, 8)} була змінена після створення.`,
      href: "/admin/time",
      severity: "low",
    })),
    ...Array.from(zeroOrNegativeBalanceIds).slice(0, 5).map((employeeId) => ({
      kind: "negative_balance",
      title: `${data.employeeMap.get(employeeId)?.fullName ?? "Працівник"}: нульовий або від'ємний баланс`,
      description: "Компанія не винна грошей або переплатила працівнику.",
      href: `/admin/payroll/${employeeId}?start=${encodeURIComponent(periodStart)}&end=${encodeURIComponent(periodEnd)}`,
      severity: "medium",
    })),
    ...Array.from(oldUnpaidEmployeeIds).map((employeeId) => ({
      kind: "old_unpaid",
      title: `${data.employeeMap.get(employeeId)?.fullName ?? "Працівник"}: старий невиплачений борг`,
      description: "Є невиплачений залишок за зміни старші за 7 днів.",
      href: `/admin/payroll/${employeeId}?start=${encodeURIComponent(periodStart)}&end=${encodeURIComponent(periodEnd)}`,
      severity: "high",
    })),
  ];

  return {
    employees: data.employees.map((employee) => ({
      id: employee.id,
      fullName: employee.fullName,
      email: employee.email,
      hourlyRate: employee.hourlyRate,
    })),
    kpis: {
      activeEmployees,
      onShiftNow: activeShiftRows.length,
      todayWorkedMinutes,
      accruedForPeriod: grossWithAdjustments,
      paidForPeriod: roundMoney(paidAmount),
      outstandingLiability: roundMoney(grossWithAdjustments - paidAmount),
    },
    activeNow: activeShiftRows,
    todayActivity: {
      totalCheckIns: todayStarted,
      totalCheckOuts: todayEnded,
      averageShiftMinutes:
        todayClosedShifts.length > 0
          ? Math.round(todayClosedShifts.reduce((sum, shift) => sum + numeric(shift.duration_minutes), 0) / todayClosedShifts.length)
          : 0,
      totalAccrualToday: roundMoney(todayAccrual),
    },
    payrollOverview: {
      accrued: grossWithAdjustments,
      advances: roundMoney(advancesAmount),
      paid: roundMoney(paidAmount),
      liability: roundMoney(grossWithAdjustments - paidAmount),
      employeesWithDebt: employeesWithDebt.size,
    },
    alerts: alerts.slice(0, 12),
    trends: eachDay(periodStart, periodEnd).map((day) => ({
      day,
      payrollAmount: roundMoney(numeric(dailyPayroll.get(day))),
      workedMinutes: numeric(dailyHours.get(day)),
      activeCount: numeric(dailyActive.get(day)),
    })),
  };
}

export async function buildAnalyticsDeepDive(periodStart: string, periodEnd: string) {
  const data = await fetchCoreRange(periodStart, periodEnd);
  const days = eachDay(periodStart, periodEnd);
  const daily = new Map(
    days.map((day) => [
      day,
      {
        day,
        payrollAmount: 0,
        advancesAmount: 0,
        paidAmount: 0,
        workedMinutes: 0,
        shiftCount: 0,
        editedShiftCount: 0,
        activeEmployees: 0,
      },
    ])
  );

  const employeeHours = new Map<string, number>();
  const employeeSalary = new Map<string, number>();
  const employeeShiftCount = new Map<string, number>();
  const employeeAdvanceCount = new Map<string, number>();

  for (const shift of data.shifts.filter((item) => item.status === "closed")) {
    const employee = data.employeeMap.get(shift.employee_id);
    if (!employee) continue;
    const minutes = Math.max(0, Math.floor(numeric(shift.duration_minutes)));
    const rate = getRateForMoment(shift.employee_id, employee.hourlyRate, shift.started_at, data.ratesByEmployee);
    const amount = roundMoney((minutes / 60) * rate);
    const day = daily.get(shift.shift_date);
    if (day) {
      day.payrollAmount = roundMoney(day.payrollAmount + amount);
      day.workedMinutes += minutes;
      day.shiftCount += 1;
      day.activeEmployees += 1;
      const created = shift.created_at ? new Date(shift.created_at).getTime() : 0;
      const updated = shift.updated_at ? new Date(shift.updated_at).getTime() : 0;
      if (updated && created && updated - created > 60_000) {
        day.editedShiftCount += 1;
      }
    }
    employeeHours.set(shift.employee_id, numeric(employeeHours.get(shift.employee_id)) + minutes);
    employeeSalary.set(shift.employee_id, roundMoney(numeric(employeeSalary.get(shift.employee_id)) + amount));
    employeeShiftCount.set(shift.employee_id, numeric(employeeShiftCount.get(shift.employee_id)) + 1);
  }

  for (const payment of data.payments) {
    const day = daily.get(payment.payment_date);
    if (!day) continue;
    day.paidAmount = roundMoney(day.paidAmount + numeric(payment.amount));
    if (payment.payment_type === "advance") {
      day.advancesAmount = roundMoney(day.advancesAmount + numeric(payment.amount));
      employeeAdvanceCount.set(payment.employee_id, numeric(employeeAdvanceCount.get(payment.employee_id)) + 1);
    }
  }

  let bonusesAmount = 0;
  let deductionsAmount = 0;
  for (const adjustment of data.adjustments) {
    if (adjustment.kind === "bonus") bonusesAmount += Math.abs(numeric(adjustment.amount));
    if (adjustment.kind === "deduction") deductionsAmount += Math.abs(numeric(adjustment.amount));
  }

  let cumulativeLiability = 0;
  const liabilitySeries = days.map((day) => {
    const row = daily.get(day)!;
    cumulativeLiability = roundMoney(cumulativeLiability + row.payrollAmount - row.paidAmount);
    return { day, liabilityAmount: cumulativeLiability };
  });

  const topByHours = Array.from(employeeHours.entries())
    .map(([employeeId, totalMinutes]) => ({
      employeeId,
      fullName: data.employeeMap.get(employeeId)?.fullName ?? "Працівник",
      totalMinutes,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
    .slice(0, 10);

  const topBySalary = Array.from(employeeSalary.entries())
    .map(([employeeId, totalAmount]) => ({
      employeeId,
      fullName: data.employeeMap.get(employeeId)?.fullName ?? "Працівник",
      totalAmount,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10);

  const topByShifts = Array.from(employeeShiftCount.entries())
    .map(([employeeId, totalShifts]) => ({
      employeeId,
      fullName: data.employeeMap.get(employeeId)?.fullName ?? "Працівник",
      totalShifts,
    }))
    .sort((a, b) => b.totalShifts - a.totalShifts)
    .slice(0, 10);

  const leastActive = data.employees
    .map((employee) => ({
      employeeId: employee.id,
      fullName: employee.fullName,
      totalMinutes: numeric(employeeHours.get(employee.id)),
    }))
    .sort((a, b) => a.totalMinutes - b.totalMinutes)
    .slice(0, 10);

  const scheduleMap = new Map<string, ScheduleBase>();
  for (const schedule of data.schedules) {
    scheduleMap.set(`${schedule.employee_id}::${schedule.work_date}`, schedule);
  }

  let earlyExitCount = 0;
  let lateExitCount = 0;
  let openInvalidCount = data.openShifts.length;
  let editedShiftCount = 0;
  for (const shift of data.shifts) {
    const schedule = scheduleMap.get(`${shift.employee_id}::${shift.shift_date}`);
    const created = shift.created_at ? new Date(shift.created_at).getTime() : 0;
    const updated = shift.updated_at ? new Date(shift.updated_at).getTime() : 0;
    if (updated && created && updated - created > 60_000) editedShiftCount += 1;
    if (!schedule || !shift.ended_at) continue;
    if (schedule.expected_start) {
      const expectedStart = new Date(`${shift.shift_date}T${schedule.expected_start}`).getTime();
      if (new Date(shift.started_at).getTime() > expectedStart + 10 * 60_000) {
        lateExitCount += 1;
      }
    }
    if (schedule.expected_end) {
      const expectedEnd = new Date(`${shift.shift_date}T${schedule.expected_end}`).getTime();
      if (new Date(shift.ended_at).getTime() < expectedEnd - 10 * 60_000) {
        earlyExitCount += 1;
      }
    }
  }

  const totalAccrual = Array.from(daily.values()).reduce((sum, row) => sum + row.payrollAmount, 0);
  const totalAdvances = Array.from(daily.values()).reduce((sum, row) => sum + row.advancesAmount, 0);
  const totalPaid = Array.from(daily.values()).reduce((sum, row) => sum + row.paidAmount, 0);
  const totalWorkedMinutes = Array.from(daily.values()).reduce((sum, row) => sum + row.workedMinutes, 0);
  const totalShiftCount = Array.from(daily.values()).reduce((sum, row) => sum + row.shiftCount, 0);
  const avgShiftMinutes = totalShiftCount > 0 ? Math.round(totalWorkedMinutes / totalShiftCount) : 0;
  const advancesEmployees = new Set(data.payments.filter((p) => p.payment_type === "advance").map((p) => p.employee_id));

  const dailyRows = days.map((day) => ({
    day,
    payrollAmount: roundMoney(daily.get(day)!.payrollAmount),
    advancesAmount: roundMoney(daily.get(day)!.advancesAmount),
    paidAmount: roundMoney(daily.get(day)!.paidAmount),
    workedMinutes: daily.get(day)!.workedMinutes,
    shiftCount: daily.get(day)!.shiftCount,
    averageShiftMinutes: daily.get(day)!.shiftCount > 0 ? Math.round(daily.get(day)!.workedMinutes / daily.get(day)!.shiftCount) : 0,
    activeEmployees: daily.get(day)!.activeEmployees,
    editedShiftCount: daily.get(day)!.editedShiftCount,
  }));

  const previousHalf = Math.max(1, Math.floor(days.length / 2));
  const earlier = dailyRows.slice(0, previousHalf);
  const later = dailyRows.slice(previousHalf);
  const earlierPayroll = earlier.reduce((sum, row) => sum + row.payrollAmount, 0);
  const laterPayroll = later.reduce((sum, row) => sum + row.payrollAmount, 0);
  const earlierHours = earlier.reduce((sum, row) => sum + row.workedMinutes, 0);
  const laterHours = later.reduce((sum, row) => sum + row.workedMinutes, 0);

  const insights: string[] = [];
  if (laterPayroll > earlierPayroll * 1.1) {
    insights.push("Витрати на зарплати зростають у другій половині вибраного періоду.");
  } else if (laterPayroll < earlierPayroll * 0.9) {
    insights.push("Витрати на зарплати знизилися відносно початку періоду.");
  }
  if (laterHours > earlierHours * 1.1) {
    insights.push("Середнє навантаження персоналу зростає.");
  }
  if (totalAdvances > totalAccrual * 0.25 && totalAccrual > 0) {
    insights.push("Частка авансів стала високою відносно загальних витрат на персонал.");
  }
  if (editedShiftCount > Math.max(3, totalShiftCount * 0.1)) {
    insights.push("Частка ручних редагувань змін помітно вища за нормальну.");
  }

  const anomalies = [
    ...leastActive.slice(0, 4).map((row) => ({
      kind: "low_activity",
      title: `${row.fullName}: низька активність`,
      description: `Лише ${Math.round(row.totalMinutes / 60)} год за період.`,
    })),
    ...Array.from(employeeAdvanceCount.entries())
      .filter(([, count]) => count >= 2)
      .slice(0, 4)
      .map(([employeeId, count]) => ({
        kind: "advance_pattern",
        title: `${data.employeeMap.get(employeeId)?.fullName ?? "Працівник"}: часті аванси`,
        description: `${count} авансових виплат за вибраний період.`,
      })),
  ];

  return {
    summary: {
      totalAccrual: roundMoney(totalAccrual + bonusesAmount - deductionsAmount),
      totalAdvances: roundMoney(totalAdvances),
      totalPaid: roundMoney(totalPaid),
      liabilityEnd: roundMoney(liabilitySeries.at(-1)?.liabilityAmount ?? 0),
      avgWorkdayCost: totalShiftCount > 0 ? roundMoney(totalAccrual / totalShiftCount) : 0,
      avgHourlyCost: totalWorkedMinutes > 0 ? roundMoney(totalAccrual / (totalWorkedMinutes / 60)) : 0,
      totalWorkedMinutes,
      avgShiftMinutes,
      totalShiftCount,
      editedShiftCount,
      earlyExitCount,
      lateExitCount,
      openInvalidCount,
      advanceEmployeesCount: advancesEmployees.size,
      averageAdvanceAmount: advancesEmployees.size > 0 ? roundMoney(totalAdvances / Math.max(1, data.payments.filter((p) => p.payment_type === "advance").length)) : 0,
      advancesShare: totalAccrual > 0 ? Math.round((totalAdvances / totalAccrual) * 100) : 0,
    },
    dailyRows,
    liabilitySeries,
    topByHours,
    topBySalary,
    topByShifts,
    leastActive,
    insights,
    anomalies,
  };
}
