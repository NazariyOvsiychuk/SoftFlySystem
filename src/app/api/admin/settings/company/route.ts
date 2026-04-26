import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";

type BreakPolicyInput = {
  id?: string;
  title?: string;
  breakType?: "paid" | "unpaid";
  durationMinutes?: number;
  autoApply?: boolean;
  isRequired?: boolean;
  deductFromPayroll?: boolean;
  triggerAfterMinutes?: number | null;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

const defaultSettings = {
  minimumShiftMinutes: 60,
  maximumShiftMinutes: 960,
  timeRoundingMode: "nearest",
  timeRoundingStepMinutes: 15,
  notifyOnLongDay: true,
  notifyDailyHoursThreshold: 10,
  notifyOnLongWeek: true,
  notifyWeeklyHoursThreshold: 50,
  salaryRoundingMode: "nearest",
  salaryRoundingStep: 1,
  nightShiftEnabled: false,
  nightShiftStart: "22:00",
  nightShiftEnd: "06:00",
  nightShiftMultiplier: 1.2,
  maxBonusAdjustmentAmount: 10000,
  maxDeductionAdjustmentAmount: 10000,
  profitabilityMonthlyRentAmount: 65000,
  profitabilityTaxRate: 0.23,
  profitabilityWithdrawalFeeRate: 0.02,
};

async function requireAdmin(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) {
    return { error: NextResponse.json({ error: "Немає токена доступу." }, { status: 401 }) };
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  const { data: profile } = await scopedClient.from("profiles").select("role").eq("id", user?.id).maybeSingle();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 }) };
  }

  return { userId: user?.id ?? null };
}

function normalizeBreakPolicy(row: any) {
  return {
    id: String(row.id),
    title: String(row.title ?? "Перерва"),
    breakType: row.break_type === "paid" ? "paid" : "unpaid",
    durationMinutes: Number(row.duration_minutes ?? 30),
    autoApply: Boolean(row.auto_apply),
    isRequired: Boolean(row.is_required),
    deductFromPayroll: Boolean(row.deduct_from_payroll),
    triggerAfterMinutes: row.trigger_after_minutes == null ? null : Number(row.trigger_after_minutes),
    breakStartTime: row.break_start_time ? String(row.break_start_time).slice(0, 5) : null,
    breakEndTime: row.break_end_time ? String(row.break_end_time).slice(0, 5) : null,
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Boolean(row.is_active),
  };
}

function normalizeSettings(row: any) {
  return {
    minimumShiftMinutes: Number(row?.minimum_shift_minutes ?? defaultSettings.minimumShiftMinutes),
    maximumShiftMinutes: Number(row?.maximum_shift_minutes ?? defaultSettings.maximumShiftMinutes),
    timeRoundingMode: String(row?.time_rounding_mode ?? defaultSettings.timeRoundingMode),
    timeRoundingStepMinutes: Number(row?.time_rounding_step_minutes ?? defaultSettings.timeRoundingStepMinutes),
    notifyOnLongDay: Boolean(row?.notify_on_long_day ?? defaultSettings.notifyOnLongDay),
    notifyDailyHoursThreshold: Number(row?.notify_daily_hours_threshold ?? defaultSettings.notifyDailyHoursThreshold),
    notifyOnLongWeek: Boolean(row?.notify_on_long_week ?? defaultSettings.notifyOnLongWeek),
    notifyWeeklyHoursThreshold: Number(row?.notify_weekly_hours_threshold ?? defaultSettings.notifyWeeklyHoursThreshold),
    salaryRoundingMode: String(row?.salary_rounding_mode ?? defaultSettings.salaryRoundingMode),
    salaryRoundingStep: Number(row?.salary_rounding_step ?? defaultSettings.salaryRoundingStep),
    nightShiftEnabled: Boolean(row?.night_shift_enabled ?? defaultSettings.nightShiftEnabled),
    nightShiftStart: String(row?.night_shift_start ?? defaultSettings.nightShiftStart),
    nightShiftEnd: String(row?.night_shift_end ?? defaultSettings.nightShiftEnd),
    nightShiftMultiplier: Number(row?.night_shift_multiplier ?? defaultSettings.nightShiftMultiplier),
    maxBonusAdjustmentAmount: Number(row?.max_bonus_adjustment_amount ?? defaultSettings.maxBonusAdjustmentAmount),
    maxDeductionAdjustmentAmount: Number(row?.max_deduction_adjustment_amount ?? defaultSettings.maxDeductionAdjustmentAmount),
    profitabilityMonthlyRentAmount: Number(row?.profitability_monthly_rent_amount ?? defaultSettings.profitabilityMonthlyRentAmount),
    profitabilityTaxRate: Number(row?.profitability_tax_rate ?? defaultSettings.profitabilityTaxRate),
    profitabilityWithdrawalFeeRate: Number(row?.profitability_withdrawal_fee_rate ?? defaultSettings.profitabilityWithdrawalFeeRate),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  try {
    const [settingsResult, breaksResult, terminalsResult] = await Promise.all([
      adminSupabase.from("company_settings").select("*").eq("singleton_key", "default").maybeSingle(),
      adminSupabase.from("company_break_policies").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      adminSupabase.from("device_terminals").select("id, device_name, device_code, location_label, is_active").order("created_at", { ascending: true }),
    ]);

    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (breaksResult.error) throw new Error(breaksResult.error.message);
    if (terminalsResult.error) throw new Error(terminalsResult.error.message);

    return NextResponse.json({
      settings: normalizeSettings(settingsResult.data),
      breakPolicies: (breaksResult.data ?? []).map(normalizeBreakPolicy),
      terminals: (terminalsResult.data ?? []).map((terminal) => ({
        id: String(terminal.id),
        deviceName: String(terminal.device_name),
        deviceCode: String(terminal.device_code),
        locationLabel: terminal.location_label ? String(terminal.location_label) : "",
        isActive: Boolean(terminal.is_active),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити налаштування." },
      { status: 400 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    settings?: typeof defaultSettings;
    breakPolicies?: BreakPolicyInput[];
  };

  const settings = body.settings ?? defaultSettings;
  const breakPolicies = Array.isArray(body.breakPolicies) ? body.breakPolicies : [];

  try {
    const { error: settingsError } = await adminSupabase.from("company_settings").upsert(
      {
        singleton_key: "default",
        minimum_shift_minutes: Math.max(0, Number(settings.minimumShiftMinutes ?? defaultSettings.minimumShiftMinutes)),
        maximum_shift_minutes: Math.max(0, Number(settings.maximumShiftMinutes ?? defaultSettings.maximumShiftMinutes)),
        time_rounding_mode: settings.timeRoundingMode ?? defaultSettings.timeRoundingMode,
        time_rounding_step_minutes: Math.max(1, Number(settings.timeRoundingStepMinutes ?? defaultSettings.timeRoundingStepMinutes)),
        notify_on_long_day: Boolean(settings.notifyOnLongDay),
        notify_daily_hours_threshold: Math.max(0, Number(settings.notifyDailyHoursThreshold ?? defaultSettings.notifyDailyHoursThreshold)),
        notify_on_long_week: Boolean(settings.notifyOnLongWeek),
        notify_weekly_hours_threshold: Math.max(0, Number(settings.notifyWeeklyHoursThreshold ?? defaultSettings.notifyWeeklyHoursThreshold)),
        salary_rounding_mode: settings.salaryRoundingMode ?? defaultSettings.salaryRoundingMode,
        salary_rounding_step: Math.max(0, Number(settings.salaryRoundingStep ?? defaultSettings.salaryRoundingStep)),
        night_shift_enabled: Boolean(settings.nightShiftEnabled),
        night_shift_start: settings.nightShiftStart ?? defaultSettings.nightShiftStart,
        night_shift_end: settings.nightShiftEnd ?? defaultSettings.nightShiftEnd,
        night_shift_multiplier: Math.max(1, Number(settings.nightShiftMultiplier ?? defaultSettings.nightShiftMultiplier)),
        max_bonus_adjustment_amount: Math.max(0, Number(settings.maxBonusAdjustmentAmount ?? defaultSettings.maxBonusAdjustmentAmount)),
        max_deduction_adjustment_amount: Math.max(0, Number(settings.maxDeductionAdjustmentAmount ?? defaultSettings.maxDeductionAdjustmentAmount)),
        profitability_monthly_rent_amount: Math.max(0, Number(settings.profitabilityMonthlyRentAmount ?? defaultSettings.profitabilityMonthlyRentAmount)),
        profitability_tax_rate: Math.max(0, Number(settings.profitabilityTaxRate ?? defaultSettings.profitabilityTaxRate)),
        profitability_withdrawal_fee_rate: Math.max(0, Number(settings.profitabilityWithdrawalFeeRate ?? defaultSettings.profitabilityWithdrawalFeeRate)),
      },
      { onConflict: "singleton_key" }
    );

    if (settingsError) throw new Error(settingsError.message);

    const { data: existingBreaks, error: existingBreaksError } = await adminSupabase
      .from("company_break_policies")
      .select("id");
    if (existingBreaksError) throw new Error(existingBreaksError.message);

    const idsToKeep = new Set<string>();

    for (const [index, policy] of breakPolicies.entries()) {
      const payload = {
        title: (policy.title ?? "Перерва").trim() || "Перерва",
        break_type: policy.breakType === "paid" ? "paid" : "unpaid",
        duration_minutes: Math.max(1, Number(policy.durationMinutes ?? 30)),
        auto_apply: Boolean(policy.autoApply),
        is_required: Boolean(policy.isRequired),
        deduct_from_payroll: Boolean(policy.deductFromPayroll),
        trigger_after_minutes: policy.triggerAfterMinutes == null || policy.triggerAfterMinutes === 0 ? null : Math.max(1, Number(policy.triggerAfterMinutes)),
        break_start_time: policy.breakStartTime || null,
        break_end_time: policy.breakEndTime || null,
        sort_order: Number(policy.sortOrder ?? index),
        is_active: Boolean(policy.isActive ?? true),
      };

      if (policy.id) {
        const { error } = await adminSupabase.from("company_break_policies").update(payload).eq("id", policy.id);
        if (error) throw new Error(error.message);
        idsToKeep.add(policy.id);
      } else {
        const { data, error } = await adminSupabase.from("company_break_policies").insert(payload).select("id").single();
        if (error || !data) throw new Error(error?.message ?? "Не вдалося створити політику перерви.");
        idsToKeep.add(String(data.id));
      }
    }

    const idsToDelete = (existingBreaks ?? [])
      .map((row) => String(row.id))
      .filter((id) => !idsToKeep.has(id));

    if (idsToDelete.length) {
      const { error: deleteError } = await adminSupabase.from("company_break_policies").delete().in("id", idsToDelete);
      if (deleteError) throw new Error(deleteError.message);
    }

    return NextResponse.json({ message: "Налаштування компанії збережено." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося зберегти налаштування." },
      { status: 400 }
    );
  }
}
