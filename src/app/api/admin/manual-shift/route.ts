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
    employeeId: string;
    action: "start" | "finish";
  };

  const { error } = await adminSupabase.rpc("admin_manual_shift_action", {
    p_employee_id: body.employeeId,
    p_action: body.action,
    p_actor_id: user?.id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    message: body.action === "start" ? "Зміну відкрито вручну." : "Зміну завершено вручну.",
  });
}

