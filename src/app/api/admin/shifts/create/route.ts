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
    employeeId?: string;
    startedAt?: string;
    endedAt?: string | null;
    status?: "open" | "closed" | "flagged";
  };

  if (!body.employeeId || !body.startedAt) {
    return NextResponse.json({ error: "Не вистачає даних зміни." }, { status: 400 });
  }

  const started = new Date(body.startedAt);
  const ended = body.endedAt ? new Date(body.endedAt) : null;
  if (Number.isNaN(started.getTime()) || (ended && Number.isNaN(ended.getTime()))) {
    return NextResponse.json({ error: "Некоректна дата або час." }, { status: 400 });
  }
  if (ended && ended.getTime() < started.getTime()) {
    return NextResponse.json({ error: "check-out не може бути раніше check-in." }, { status: 400 });
  }

  const shiftDate = started.toISOString().slice(0, 10);
  const status = body.status ?? (ended ? "closed" : "open");

  const { error } = await adminSupabase.from("shifts").insert({
    employee_id: body.employeeId,
    shift_date: shiftDate,
    started_at: started.toISOString(),
    ended_at: ended ? ended.toISOString() : null,
    status,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: "Зміну додано." });
}

