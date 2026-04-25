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

export async function GET(request: NextRequest) {
  const auth = await ensureAdmin(request);
  if ("response" in auth) return auth.response;

  const { data, error } = await adminSupabase
    .from("overtime_rules")
    .select("id, is_active, overtime_threshold_minutes_per_day, overtime_multiplier, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    rule: data ?? {
      overtime_threshold_minutes_per_day: 480,
      overtime_multiplier: 1.25,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json()) as {
    overtimeThresholdMinutesPerDay: number;
    overtimeMultiplier: number;
  };

  const threshold = Math.max(0, Math.floor(Number(body.overtimeThresholdMinutesPerDay ?? 0)));
  const multiplier = Math.max(1, Number(body.overtimeMultiplier ?? 1));

  await adminSupabase.from("overtime_rules").update({ is_active: false }).eq("is_active", true);

  const { error } = await adminSupabase.from("overtime_rules").insert({
    overtime_threshold_minutes_per_day: threshold,
    overtime_multiplier: multiplier,
    is_active: true,
    created_by: auth.user?.id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: "Правила понаднормових збережено." });
}

