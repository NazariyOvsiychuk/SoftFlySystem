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

  const body = (await request.json()) as {
    deviceName: string;
    deviceCode: string;
    secretKey: string;
    locationLabel: string;
  };

  const { error } = await adminSupabase.from("device_terminals").insert({
    device_name: body.deviceName,
    device_code: body.deviceCode,
    secret_key: body.secretKey,
    location_label: body.locationLabel || null,
    is_active: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: "Trusted terminal створено." });
}
