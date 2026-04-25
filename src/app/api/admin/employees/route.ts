import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";
import { recordEmployeeCreated } from "@/lib/domain/payroll-domain";

export async function POST(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!accessToken) {
    return NextResponse.json({ error: "Немає токена доступу." }, { status: 401 });
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Сесію не підтверджено." }, { status: 401 });
  }

  const { data: profile } = await scopedClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 });
  }

  const body = (await request.json()) as {
    fullName: string;
    email: string;
    password: string;
    hourlyRate: number;
  };

  const { data: createdUser, error: createError } = await adminSupabase.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: {
      full_name: body.fullName,
      role: "employee",
    },
  });

  if (createError || !createdUser.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Не вдалося створити користувача." },
      { status: 400 }
    );
  }

  // `handle_new_user()` trigger should create `employee_settings`, but in real projects
  // it can be missing/migrated later. Use upsert so hourly rate is always persisted.
  const { error: settingsError } = await adminSupabase.from("employee_settings").upsert(
    {
      employee_id: createdUser.user.id,
      hourly_rate: body.hourlyRate,
    },
    { onConflict: "employee_id" }
  );

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 400 });
  }

  try {
    await recordEmployeeCreated({
      employeeId: createdUser.user.id,
      actorId: user.id,
      fullName: body.fullName,
      email: body.email,
      hourlyRate: body.hourlyRate,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося зафіксувати payroll-події." },
      { status: 400 }
    );
  }

  return NextResponse.json({ message: "Працівника створено." });
}
