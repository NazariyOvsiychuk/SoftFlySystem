import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/lib/admin-server";
import { buildDashboardControlCenter } from "@/lib/operations-admin";

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

  const body = (await request.json().catch(() => ({}))) as { start?: string; end?: string };
  if (!body.start || !body.end) {
    return NextResponse.json({ error: "Потрібні start і end." }, { status: 400 });
  }

  try {
    const payload = await buildDashboardControlCenter(body.start, body.end);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити dashboard." },
      { status: 400 }
    );
  }
}

