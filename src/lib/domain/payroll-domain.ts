import { adminSupabase } from "@/lib/admin-server";

export type PayrollCommand =
  | {
      type: "EmployeeCreated";
      employeeId: string;
      actorId: string | null;
      payload: { fullName: string; email: string; hourlyRate: number };
    }
  | {
      type: "HourlyRateChanged";
      employeeId: string;
      actorId: string | null;
      payload: { hourlyRate: number; effectiveFrom: string };
    }
  | {
      type: "AdvancePaid";
      employeeId: string;
      actorId: string | null;
      payload: { amount: number; paymentDate: string; comment?: string | null };
    }
  | {
      type: "SalaryPaid";
      employeeId: string;
      actorId: string | null;
      payload: { amount: number; paymentDate: string; comment?: string | null };
    };

function asMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function nextEventVersion(aggregateType: string, aggregateId: string) {
  const { data, error } = await adminSupabase
    .from("domain_events")
    .select("event_version")
    .eq("aggregate_type", aggregateType)
    .eq("aggregate_id", aggregateId)
    .order("event_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Number(data?.event_version ?? 0) + 1;
}

export async function appendDomainEvent(command: PayrollCommand) {
  const aggregateType = "Employee";
  const aggregateId = command.employeeId;
  const eventVersion = await nextEventVersion(aggregateType, aggregateId);

  const { data, error } = await adminSupabase
    .from("domain_events")
    .insert({
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      event_type: command.type,
      event_version: eventVersion,
      payload: command.payload,
      actor_id: command.actorId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Не вдалося записати подію.");
  }

  return String(data.id);
}

export async function recordHourlyRateChange(args: {
  employeeId: string;
  actorId: string | null;
  hourlyRate: number;
  effectiveFrom?: string;
}) {
  const effectiveFrom = args.effectiveFrom ?? new Date().toISOString();
  const eventId = await appendDomainEvent({
    type: "HourlyRateChanged",
    employeeId: args.employeeId,
    actorId: args.actorId,
    payload: { hourlyRate: asMoney(args.hourlyRate), effectiveFrom },
  });

  const { error } = await adminSupabase.from("employee_hourly_rates").insert({
    employee_id: args.employeeId,
    hourly_rate: asMoney(args.hourlyRate),
    effective_from: effectiveFrom,
    created_by: args.actorId,
    source_event_id: eventId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return eventId;
}

export async function recordEmployeeCreated(args: {
  employeeId: string;
  actorId: string | null;
  fullName: string;
  email: string;
  hourlyRate: number;
}) {
  await appendDomainEvent({
    type: "EmployeeCreated",
    employeeId: args.employeeId,
    actorId: args.actorId,
    payload: {
      fullName: args.fullName,
      email: args.email,
      hourlyRate: asMoney(args.hourlyRate),
    },
  });

  await recordHourlyRateChange({
    employeeId: args.employeeId,
    actorId: args.actorId,
    hourlyRate: args.hourlyRate,
  });
}

export async function recordPayment(args: {
  employeeId: string;
  actorId: string | null;
  paymentType: "advance" | "salary";
  amount: number;
  paymentDate: string;
  comment?: string | null;
}) {
  const normalizedAmount = asMoney(args.amount);
  const eventId = await appendDomainEvent({
    type: args.paymentType === "advance" ? "AdvancePaid" : "SalaryPaid",
    employeeId: args.employeeId,
    actorId: args.actorId,
    payload: {
      amount: normalizedAmount,
      paymentDate: args.paymentDate,
      comment: args.comment ?? null,
    },
  });

  const { data: paymentRow, error: paymentError } = await adminSupabase
    .from("salary_payments")
    .insert({
      employee_id: args.employeeId,
      payment_date: args.paymentDate,
      payment_type: args.paymentType,
      amount: normalizedAmount,
      comment: args.comment ?? null,
      created_by: args.actorId,
    })
    .select("id")
    .single();

  if (paymentError || !paymentRow) {
    throw new Error(paymentError.message);
  }

  const { error: ledgerError } = await adminSupabase.from("financial_ledger_entries").insert({
    employee_id: args.employeeId,
    entry_type: args.paymentType === "advance" ? "advance" : "payment",
    amount: -Math.abs(normalizedAmount),
    occurred_on: args.paymentDate,
    comment: args.comment ?? null,
    related_event_id: eventId,
    created_by: args.actorId,
    metadata: { paymentType: args.paymentType, paymentId: paymentRow.id },
  });

  if (ledgerError) {
    throw new Error(ledgerError.message);
  }

  return eventId;
}
