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

  const body = (await request.json()) as {
    workDate: string;
    employeeId?: string;
    employeeIds?: string[];
    applyToAll?: boolean;
  };

  if (!body.workDate) {
    return NextResponse.json({ error: "workDate обов'язковий." }, { status: 400 });
  }

  const applyToAll = Boolean(body.applyToAll);
  const employeeIds = Array.isArray(body.employeeIds) ? body.employeeIds.filter(Boolean) : [];
  if (!applyToAll && !body.employeeId) {
    if (!employeeIds.length) {
      return NextResponse.json({ error: "employeeId обов'язковий (або employeeIds/applyToAll=true)." }, { status: 400 });
    }
  }

  let query = adminSupabase.from("schedule_days").delete().eq("work_date", body.workDate);
  if (!applyToAll) {
    if (employeeIds.length) {
      query = query.in("employee_id", employeeIds);
    } else if (body.employeeId) {
      query = query.eq("employee_id", body.employeeId);
    }
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: applyToAll ? "День видалено для всіх." : "День видалено." });
}
