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

  const body = (await request.json()) as {
    employeeId: string;
    periodStart: string;
    periodEnd: string;
    bonuses: number;
    deductions: number;
    notes?: string;
  };

  const { data: period, error: periodError } = await adminSupabase
    .from("payroll_periods")
    .upsert(
      {
        period_start: body.periodStart,
        period_end: body.periodEnd,
        created_by: user?.id ?? null,
      },
      { onConflict: "period_start,period_end" }
    )
    .select("id")
    .single();

  if (periodError || !period) {
    return NextResponse.json(
      { error: periodError?.message ?? "Не вдалося створити зарплатний період." },
      { status: 400 }
    );
  }

  const { data: baseEntry, error: baseError } = await adminSupabase.rpc("generate_payroll_entry", {
    p_payroll_period_id: period.id,
    p_employee_id: body.employeeId,
  });

  if (baseError || !baseEntry) {
    return NextResponse.json(
      { error: baseError?.message ?? "Не вдалося згенерувати нарахування." },
      { status: 400 }
    );
  }

  const grossAmount = Number(baseEntry.gross_amount ?? 0);
  const bonuses = Number(body.bonuses ?? 0);
  const deductions = Number(body.deductions ?? 0);
  const finalAmount = grossAmount + bonuses - deductions;

  const { error: updateError } = await adminSupabase
    .from("payroll_entries")
    .update({
      bonuses,
      deductions,
      final_amount: finalAmount,
      notes: body.notes ?? null,
    })
    .eq("id", baseEntry.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ message: "Нарахування розраховано." });
}
