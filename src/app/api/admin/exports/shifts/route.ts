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

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const auth = await ensureAdmin(request);
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const query = adminSupabase
    .from("shifts")
    .select(
      "shift_date, started_at, ended_at, duration_minutes, status, profiles!shifts_employee_id_fkey(full_name,email)"
    )
    .order("started_at", { ascending: false })
    .limit(5000);

  if (start) query.gte("shift_date", start);
  if (end) query.lte("shift_date", end);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = [
    ["date", "employee", "email", "started_at", "ended_at", "minutes", "status"],
    ...(data ?? []).map((shift: any) => [
      shift.shift_date,
      shift.profiles?.full_name ?? "",
      shift.profiles?.email ?? "",
      shift.started_at ?? "",
      shift.ended_at ?? "",
      shift.duration_minutes ?? "",
      shift.status ?? "",
    ]),
  ];

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"shifts.csv\"`,
    },
  });
}

