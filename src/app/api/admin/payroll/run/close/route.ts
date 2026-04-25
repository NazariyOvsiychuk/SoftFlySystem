import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";

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

  const body = (await request.json().catch(() => ({}))) as {
    payrollRunId?: string;
    periodStart?: string;
    periodEnd?: string;
  };

  let payrollRunId = body.payrollRunId;
  if (!payrollRunId && body.periodStart && body.periodEnd) {
    const { data: draftRun, error: draftError } = await adminSupabase
      .from("payroll_runs")
      .select("id")
      .eq("period_start", body.periodStart)
      .eq("period_end", body.periodEnd)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftError) {
      return NextResponse.json({ error: draftError.message }, { status: 400 });
    }
    payrollRunId = draftRun?.id;
  }

  if (!payrollRunId) {
    return NextResponse.json({ error: "Не знайдено payroll run для закриття." }, { status: 400 });
  }

  const { error } = await adminSupabase
    .from("payroll_runs")
    .update({
      status: "paid",
      closed_at: new Date().toISOString(),
      closed_by: user?.id ?? null,
    })
    .eq("id", payrollRunId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: "Період зарплати закрито." });
}
