import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/lib/admin-server";
import { buildEmployeeDashboardData } from "@/lib/employee-dashboard-data";

export async function GET(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) {
    return NextResponse.json({ error: "Немає токена доступу." }, { status: 401 });
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  const { data: profile } = await scopedClient.from("profiles").select("role").eq("id", user?.id).maybeSingle();
  if (profile?.role !== "employee") {
    return NextResponse.json({ error: "Доступ лише для працівника." }, { status: 403 });
  }

  try {
    const payload = await buildEmployeeDashboardData(user!.id);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити кабінет працівника." },
      { status: 400 }
    );
  }
}
