import { adminSupabase } from "@/lib/admin-server";

export type PayrollCompanySettings = {
  nightShiftEnabled: boolean;
  nightShiftStart: string;
  nightShiftEnd: string;
  nightShiftMultiplier: number;
};

export type BreakPolicy = {
  id: string;
  title: string;
  breakType: "paid" | "unpaid";
  durationMinutes: number;
  autoApply: boolean;
  isRequired: boolean;
  deductFromPayroll: boolean;
  triggerAfterMinutes: number | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  isActive: boolean;
};

export type ShiftCompensation = {
  payableMinutes: number;
  unpaidBreakMinutes: number;
  nightMinutes: number;
  grossAmount: number;
};

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function overlapMinutes(startA: Date, endA: Date, startB: Date, endB: Date) {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  if (end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function buildWindowForDate(date: Date, startMinutes: number, endMinutes: number) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(startMinutes);

  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  end.setMinutes(endMinutes);

  if (endMinutes <= startMinutes) {
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}

function enumerateShiftDays(start: Date, end: Date) {
  const days: Date[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const limit = new Date(end);
  limit.setHours(0, 0, 0, 0);

  while (current.getTime() <= limit.getTime()) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function getShiftEnd(startedAt: string, endedAt: string | null, durationMinutes: number) {
  const start = new Date(startedAt);
  if (endedAt) {
    return new Date(endedAt);
  }
  return new Date(start.getTime() + durationMinutes * 60000);
}

export async function loadPayrollRules() {
  const [settingsResult, breaksResult] = await Promise.all([
    adminSupabase
      .from("company_settings")
      .select("night_shift_enabled, night_shift_start, night_shift_end, night_shift_multiplier")
      .eq("singleton_key", "default")
      .maybeSingle(),
    adminSupabase
      .from("company_break_policies")
      .select("id, title, break_type, duration_minutes, auto_apply, is_required, deduct_from_payroll, trigger_after_minutes, break_start_time, break_end_time, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (breaksResult.error) throw new Error(breaksResult.error.message);

  const settings: PayrollCompanySettings = {
    nightShiftEnabled: Boolean(settingsResult.data?.night_shift_enabled),
    nightShiftStart: String(settingsResult.data?.night_shift_start ?? "22:00"),
    nightShiftEnd: String(settingsResult.data?.night_shift_end ?? "06:00"),
    nightShiftMultiplier: Math.max(1, numeric(settingsResult.data?.night_shift_multiplier) || 1),
  };

  const breakPolicies: BreakPolicy[] = (breaksResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    title: String(row.title ?? "Перерва"),
    breakType: row.break_type === "paid" ? "paid" : "unpaid",
    durationMinutes: Math.max(0, numeric(row.duration_minutes)),
    autoApply: Boolean(row.auto_apply),
    isRequired: Boolean(row.is_required),
    deductFromPayroll: Boolean(row.deduct_from_payroll),
    triggerAfterMinutes: row.trigger_after_minutes == null ? null : Math.max(0, numeric(row.trigger_after_minutes)),
    breakStartTime: row.break_start_time ? String(row.break_start_time).slice(0, 5) : null,
    breakEndTime: row.break_end_time ? String(row.break_end_time).slice(0, 5) : null,
    isActive: Boolean(row.is_active),
  }));

  return { settings, breakPolicies };
}

export function calculateShiftCompensation(input: {
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  hourlyRate: number;
  settings: PayrollCompanySettings;
  breakPolicies: BreakPolicy[];
}) {
  const startedAt = new Date(input.startedAt);
  const endedAt = getShiftEnd(input.startedAt, input.endedAt, input.durationMinutes);
  const totalMinutes = Math.max(0, Math.floor(input.durationMinutes));

  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || totalMinutes <= 0) {
    return {
      payableMinutes: 0,
      unpaidBreakMinutes: 0,
      nightMinutes: 0,
      grossAmount: 0,
    } satisfies ShiftCompensation;
  }

  let unpaidBreakMinutes = 0;
  const shiftDays = enumerateShiftDays(startedAt, endedAt);

  for (const policy of input.breakPolicies) {
    if (!policy.isActive) continue;
    if (!policy.autoApply) continue;
    if (policy.breakType !== "unpaid") continue;
    if (!policy.deductFromPayroll) continue;
    if (policy.triggerAfterMinutes != null && totalMinutes < policy.triggerAfterMinutes) continue;

    const breakStartMinutes = parseTimeToMinutes(policy.breakStartTime);
    const breakEndMinutes = parseTimeToMinutes(policy.breakEndTime);

    if (breakStartMinutes != null && breakEndMinutes != null) {
      let overlapped = 0;
      for (const day of shiftDays) {
        const window = buildWindowForDate(day, breakStartMinutes, breakEndMinutes);
        overlapped += overlapMinutes(startedAt, endedAt, window.start, window.end);
      }
      unpaidBreakMinutes += overlapped;
      continue;
    }

    unpaidBreakMinutes += Math.max(0, policy.durationMinutes);
  }

  unpaidBreakMinutes = Math.min(totalMinutes, unpaidBreakMinutes);
  const payableMinutes = Math.max(0, totalMinutes - unpaidBreakMinutes);

  let nightMinutes = 0;
  if (input.settings.nightShiftEnabled) {
    const nightStartMinutes = parseTimeToMinutes(input.settings.nightShiftStart);
    const nightEndMinutes = parseTimeToMinutes(input.settings.nightShiftEnd);
    if (nightStartMinutes != null && nightEndMinutes != null) {
      for (const day of shiftDays) {
        const window = buildWindowForDate(day, nightStartMinutes, nightEndMinutes);
        nightMinutes += overlapMinutes(startedAt, endedAt, window.start, window.end);
      }
      nightMinutes = Math.min(payableMinutes, nightMinutes);
    }
  }

  const baseAmount = (payableMinutes / 60) * input.hourlyRate;
  const nightExtraAmount =
    input.settings.nightShiftEnabled && input.settings.nightShiftMultiplier > 1
      ? (nightMinutes / 60) * input.hourlyRate * (input.settings.nightShiftMultiplier - 1)
      : 0;

  return {
    payableMinutes,
    unpaidBreakMinutes,
    nightMinutes,
    grossAmount: roundMoney(baseAmount + nightExtraAmount),
  } satisfies ShiftCompensation;
}
