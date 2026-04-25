import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";

async function ensureAdmin(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!accessToken) {
    return { response: NextResponse.json({ error: "Немає токена доступу." }, { status: 401 }) };
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
    return { response: NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 }) };
  }

  return { user };
}

export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json()) as { start: string; end: string };
  const start = body.start;
  const end = body.end;

  const [
    { data: currentOnShift, error: currentOnShiftError },
    { data: topHours, error: topHoursError },
    { data: laborCostByDay, error: laborCostError },
  ] = await Promise.all([
    adminSupabase.rpc("analytics_current_on_shift"),
    adminSupabase.rpc("analytics_top_hours", { p_start: start, p_end: end, p_limit: 10 }),
    adminSupabase.rpc("analytics_labor_cost_by_day", { p_start: start, p_end: end }),
  ]);

  const rpcError = currentOnShiftError ?? topHoursError ?? laborCostError;
  if (rpcError) {
    return NextResponse.json(
      {
        error:
          rpcError.message ??
          "Не вдалося завантажити аналітику. Перевір, чи встановлені RPC functions у Supabase (schema.sql).",
      },
      { status: 400 }
    );
  }

  const { data: employees } = await adminSupabase
    .from("profiles")
    .select("id, full_name, is_active")
    .eq("role", "employee")
    .eq("is_active", true);

  const disciplineRows: Array<{
    employeeId: string;
    fullName: string;
    missedRequiredDays: number;
    lateCheckins: number;
    earlyCheckouts: number;
    openWithoutCheckout: number;
    disciplineScore: number;
  }> = [];

  for (const employee of employees ?? []) {
    const { data, error } = await adminSupabase.rpc("analytics_discipline", {
      p_employee_id: employee.id,
      p_start: start,
      p_end: end,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) continue;

    disciplineRows.push({
      employeeId: employee.id,
      fullName: employee.full_name,
      missedRequiredDays: Number(row.missed_required_days ?? 0),
      lateCheckins: Number(row.late_checkins ?? 0),
      earlyCheckouts: Number(row.early_checkouts ?? 0),
      openWithoutCheckout: Number(row.open_without_checkout ?? 0),
      disciplineScore: Number(row.discipline_score ?? 0),
    });
  }

  disciplineRows.sort((a, b) => b.disciplineScore - a.disciplineScore);

  return NextResponse.json({
    currentOnShift: Number(currentOnShift ?? 0),
    topHours: topHours ?? [],
    laborCostByDay: laborCostByDay ?? [],
    disciplineTop: disciplineRows.slice(0, 10),
    disciplineBottom: disciplineRows.slice(-10).reverse(),
  });
}
