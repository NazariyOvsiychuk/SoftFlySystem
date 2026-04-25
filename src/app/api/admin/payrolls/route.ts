import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/lib/admin-server";
import { buildPayrollSummary } from "@/lib/payroll-admin";

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toDate = (value: Date) =>
    new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { start: toDate(start), end: toDate(end) };
}

async function requireAdmin(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) {
    return { error: NextResponse.json({ error: "Немає токена доступу." }, { status: 401 }) };
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
    return { error: NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 }) };
  }

  return { ok: true as const };
}

async function resolveRange(request: NextRequest) {
  const url = new URL(request.url);
  const queryStart = url.searchParams.get("start") || url.searchParams.get("periodStart");
  const queryEnd = url.searchParams.get("end") || url.searchParams.get("periodEnd");

  if (queryStart && queryEnd) {
    return { periodStart: queryStart, periodEnd: queryEnd };
  }

  if (request.method !== "GET") {
    const body = (await request.json().catch(() => ({}))) as {
      start?: string;
      end?: string;
      periodStart?: string;
      periodEnd?: string;
    };
    const periodStart = body.periodStart ?? body.start;
    const periodEnd = body.periodEnd ?? body.end;
    if (periodStart && periodEnd) {
      return { periodStart, periodEnd };
    }
  }

  return { periodStart: monthRange().start, periodEnd: monthRange().end };
}

async function handle(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  try {
    const { periodStart, periodEnd } = await resolveRange(request);
    const payload = await buildPayrollSummary(periodStart, periodEnd);
    return NextResponse.json({
      rows: payload.rows,
      totals: payload.totals,
      payments: payload.payments,
      periodStart,
      periodEnd,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити payroll." },
      { status: 400 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
