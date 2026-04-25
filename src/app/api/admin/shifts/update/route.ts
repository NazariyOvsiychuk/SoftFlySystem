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
    shiftId: string;
    startedAt: string;
    endedAt: string | null;
    status: "open" | "closed" | "flagged";
  };

  if (!body.shiftId || !body.startedAt) {
    return NextResponse.json({ error: "Не вистачає даних зміни." }, { status: 400 });
  }

  const started = new Date(body.startedAt);
  const ended = body.endedAt ? new Date(body.endedAt) : null;
  if (Number.isNaN(started.getTime()) || (ended && Number.isNaN(ended.getTime()))) {
    return NextResponse.json({ error: "Некоректний формат дати/часу." }, { status: 400 });
  }
  if (ended && ended.getTime() < started.getTime()) {
    return NextResponse.json({ error: "ended_at не може бути раніше started_at." }, { status: 400 });
  }

  const normalizedStatus = body.status ?? (ended ? "closed" : "open");

  const { error } = await adminSupabase
    .from("shifts")
    .update({
      started_at: started.toISOString(),
      ended_at: ended ? ended.toISOString() : null,
      status: normalizedStatus,
    })
    .eq("id", body.shiftId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: "Зміну оновлено." });
}

