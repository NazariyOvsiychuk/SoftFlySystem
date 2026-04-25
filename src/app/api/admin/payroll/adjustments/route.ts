import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";

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

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    employeeId?: string;
    kind?: "bonus" | "deduction";
    amount?: number;
    effectiveDate?: string;
    reason?: string;
  };

  if (!body.employeeId || !body.kind || !body.effectiveDate || !body.amount) {
    return NextResponse.json({ error: "Не вистачає даних для бонусу або штрафу." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Сума має бути більшою за 0." }, { status: 400 });
  }

  const normalizedReason = body.reason?.trim() || null;
  const normalizedAmount = Math.round(amount * 100) / 100;

  const { data: adjustment, error: adjustmentError } = await adminSupabase
    .from("pay_adjustments")
    .insert({
      employee_id: body.employeeId,
      amount: normalizedAmount,
      kind: body.kind,
      reason: normalizedReason,
      effective_date: body.effectiveDate,
      created_by: auth.userId,
    })
    .select("id")
    .single();

  if (adjustmentError || !adjustment) {
    return NextResponse.json({ error: adjustmentError?.message ?? "Не вдалося створити коригування." }, { status: 400 });
  }

  const { error: ledgerError } = await adminSupabase.from("financial_ledger_entries").insert({
    employee_id: body.employeeId,
    entry_type: body.kind === "bonus" ? "bonus" : "penalty",
    amount: body.kind === "bonus" ? normalizedAmount : -normalizedAmount,
    occurred_on: body.effectiveDate,
    comment: normalizedReason,
    created_by: auth.userId,
    metadata: {
      adjustmentId: adjustment.id,
      kind: body.kind,
    },
  });

  if (ledgerError) {
    return NextResponse.json({ error: ledgerError.message }, { status: 400 });
  }

  return NextResponse.json({ message: body.kind === "bonus" ? "Бонус додано." : "Штраф додано." });
}
