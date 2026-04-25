import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    deviceCode: string;
    pinCode: string;
  };

  const deviceSecret = request.headers.get("x-terminal-secret");

  const { data: device, error: deviceError } = await adminSupabase
    .from("device_terminals")
    .select("id, secret_key, is_active")
    .eq("device_code", body.deviceCode)
    .maybeSingle();

  if (deviceError || !device || !device.is_active || device.secret_key !== deviceSecret) {
    return NextResponse.json({ error: "Термінал не авторизовано." }, { status: 401 });
  }

  const { data: employee, error } = await adminSupabase.rpc("terminal_identify_employee", {
    p_pin_code: body.pinCode,
  });

  if (error || !employee || employee.length === 0) {
    return NextResponse.json({ error: "Працівника не знайдено." }, { status: 404 });
  }

  const currentEmployee = employee[0];

  const { data: openShift } = await adminSupabase
    .from("shifts")
    .select("id")
    .eq("employee_id", currentEmployee.employee_id)
    .eq("status", "open")
    .maybeSingle();

  return NextResponse.json({
    employeeId: currentEmployee.employee_id,
    fullName: currentEmployee.full_name,
    fingerprintId: currentEmployee.fingerprint_id,
    nextAction: openShift ? "finish" : "start",
  });
}
