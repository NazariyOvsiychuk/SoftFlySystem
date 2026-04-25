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
    employeeId?: string;
    employeeIds?: string[];
    applyToAll?: boolean;
    workDate: string;
    dayType: "required" | "preferred" | "off";
    expectedStart?: string;
    expectedEnd?: string;
  };

  const applyToAll = Boolean(body.applyToAll);
  const employeeIds = Array.isArray(body.employeeIds) ? body.employeeIds.filter(Boolean) : [];

  if (applyToAll) {
    const { data: employees, error: employeesError } = await adminSupabase
      .from("profiles")
      .select("id")
      .eq("role", "employee")
      .eq("is_active", true);

    if (employeesError) {
      return NextResponse.json({ error: employeesError.message }, { status: 400 });
    }

    const rows = (employees ?? []).map((employee) => ({
      employee_id: employee.id,
      work_date: body.workDate,
      day_type: body.dayType,
      expected_start: body.expectedStart || null,
      expected_end: body.expectedEnd || null,
      created_by: user?.id ?? null,
    }));

    const { error } = await adminSupabase
      .from("schedule_days")
      .upsert(rows, { onConflict: "employee_id,work_date" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ message: "Графік оновлено для всіх працівників." });
  }

  if (employeeIds.length) {
    const rows = employeeIds.map((employeeId) => ({
      employee_id: employeeId,
      work_date: body.workDate,
      day_type: body.dayType,
      expected_start: body.expectedStart || null,
      expected_end: body.expectedEnd || null,
      created_by: user?.id ?? null,
    }));

    const { error } = await adminSupabase
      .from("schedule_days")
      .upsert(rows, { onConflict: "employee_id,work_date" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ message: "Графік оновлено для вибраних працівників." });
  }

  if (!body.employeeId) {
    return NextResponse.json({ error: "Оберіть працівника або увімкніть режим 'для всіх'." }, { status: 400 });
  }

  const { error } = await adminSupabase.from("schedule_days").upsert(
    {
      employee_id: body.employeeId,
      work_date: body.workDate,
      day_type: body.dayType,
      expected_start: body.expectedStart || null,
      expected_end: body.expectedEnd || null,
      created_by: user?.id ?? null,
    },
    { onConflict: "employee_id,work_date" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: "Графік оновлено." });
}
