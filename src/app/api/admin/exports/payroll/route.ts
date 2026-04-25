import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/lib/admin-server";
import { buildPayrollSummary } from "@/lib/payroll-admin";

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const periodStart = searchParams.get("start");
  const periodEnd = searchParams.get("end");

  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "Потрібні start та end." }, { status: 400 });
  }

  try {
    const summary = await buildPayrollSummary(periodStart, periodEnd);
    const rows = [
      [
        "Працівник",
        "Email",
        "Ставка",
        "Години",
        "Нараховано",
        "Бонуси",
        "Штрафи",
        "До виплати",
        "Виплачено",
        "Залишок",
      ],
      ...summary.rows.map((row) => [
        row.fullName,
        row.email,
        row.hourlyRate,
        (row.workedMinutes / 60).toFixed(2),
        row.grossAmount.toFixed(2),
        row.bonusesAmount.toFixed(2),
        row.deductionsAmount.toFixed(2),
        row.totalDue.toFixed(2),
        row.paidAmount.toFixed(2),
        row.balanceAmount.toFixed(2),
      ]),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"payroll-${periodStart}-${periodEnd}.csv\"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося сформувати payroll-експорт." },
      { status: 400 }
    );
  }
}

