import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";
import { recordHourlyRateChange } from "@/lib/domain/payroll-domain";

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
  if ("response" in auth) {
    return auth.response;
  }

  const body = (await request.json()) as {
    employeeId: string;
    fullName: string;
    email?: string;
    password?: string;
    hourlyRate: number;
    pinCode: string;
    fingerprintId: number | null;
    terminalAccessEnabled: boolean;
    isActive: boolean;
  };

  const { data: currentSettings } = await adminSupabase
    .from("employee_settings")
    .select("hourly_rate")
    .eq("employee_id", body.employeeId)
    .maybeSingle();

  if (body.email) {
    const normalizedEmail = String(body.email).trim().toLowerCase();
    const { error: authError } = await adminSupabase.auth.admin.updateUserById(body.employeeId, {
      email: normalizedEmail,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const { error: profileEmailError } = await adminSupabase
      .from("profiles")
      .update({ email: normalizedEmail })
      .eq("id", body.employeeId);

    if (profileEmailError) {
      return NextResponse.json({ error: profileEmailError.message }, { status: 400 });
    }
  }

  if (body.password && body.password.trim()) {
    const { error: passwordError } = await adminSupabase.auth.admin.updateUserById(body.employeeId, {
      password: body.password.trim(),
    });

    if (passwordError) {
      return NextResponse.json({ error: passwordError.message }, { status: 400 });
    }
  }

  const { error: profileError } = await adminSupabase
    .from("profiles")
    .update({ full_name: body.fullName, is_active: body.isActive })
    .eq("id", body.employeeId);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const { error: settingsError } = await adminSupabase
    .from("employee_settings")
    .upsert(
      {
        employee_id: body.employeeId,
        hourly_rate: body.hourlyRate,
        pin_code: body.pinCode || null,
        fingerprint_id: body.fingerprintId,
        terminal_access_enabled: body.terminalAccessEnabled,
      },
      { onConflict: "employee_id" }
    );

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 400 });
  }

  if (Number(currentSettings?.hourly_rate ?? 0) !== Number(body.hourlyRate ?? 0)) {
    try {
      await recordHourlyRateChange({
        employeeId: body.employeeId,
        actorId: auth.user?.id ?? null,
        hourlyRate: body.hourlyRate,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Не вдалося зафіксувати зміну ставки." },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ message: "Параметри працівника оновлено." });
}
