import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/lib/admin-server";
import { buildPayrollEmployeeDetail } from "@/lib/payroll-admin";

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
    employeeId?: string;
    periodStart?: string;
    periodEnd?: string;
  };

  if (!body.employeeId || !body.periodStart || !body.periodEnd) {
    return NextResponse.json({ error: "Потрібні employeeId, periodStart та periodEnd." }, { status: 400 });
  }

  try {
    const payload = await buildPayrollEmployeeDetail(body.employeeId, body.periodStart, body.periodEnd);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити працівника." },
      { status: 400 }
    );
  }
}

