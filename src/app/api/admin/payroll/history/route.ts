import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/lib/admin-server";
import { buildPayrollSummary } from "@/lib/payroll-admin";

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

  const body = (await request.json().catch(() => ({}))) as { periodStart?: string; periodEnd?: string };
  if (!body.periodStart || !body.periodEnd) {
    return NextResponse.json({ error: "Потрібні periodStart та periodEnd." }, { status: 400 });
  }

  try {
    const payload = await buildPayrollSummary(body.periodStart, body.periodEnd);
    return NextResponse.json({ payments: payload.payments });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити історію виплат." },
      { status: 400 }
    );
  }
}

