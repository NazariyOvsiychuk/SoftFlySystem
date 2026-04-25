import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    deviceCode: string;
    employeeId: string;
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

  const { data: openShift } = await adminSupabase
    .from("shifts")
    .select("id")
    .eq("employee_id", body.employeeId)
    .eq("status", "open")
    .maybeSingle();

  const { error } = await adminSupabase.rpc("register_terminal_event", {
    p_employee_id: body.employeeId,
    p_event_type: "scan",
    p_terminal_code: body.deviceCode,
    p_source: "raspberry_pi",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    message: openShift ? "Зміну завершено." : "Зміну розпочато.",
    actionApplied: openShift ? "finish" : "start",
  });
}
