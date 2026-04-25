import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";
import { recordPayment } from "@/lib/domain/payroll-domain";

async function requireAdmin(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) {
    return { error: NextResponse.json({ error: "Немає токена доступу." }, { status: 401 }) };
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  const { data: profile } = await scopedClient.from("profiles").select("role").eq("id", user?.id).maybeSingle();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 }) };
  }

  return { userId: user?.id ?? null };
}

async function findPaymentAndLedger(paymentId: string) {
  const { data: payment, error: paymentError } = await adminSupabase
    .from("salary_payments")
    .select("id, employee_id, payment_date, payment_type, amount, comment, created_at")
    .eq("id", paymentId)
    .maybeSingle();

  if (paymentError) throw new Error(paymentError.message);
  if (!payment) throw new Error("Виплату не знайдено.");

  const directLedger = await adminSupabase
    .from("financial_ledger_entries")
    .select("id")
    .eq("employee_id", payment.employee_id)
    .contains("metadata", { paymentId })
    .limit(1)
    .maybeSingle();

  if (directLedger.error) throw new Error(directLedger.error.message);
  if (directLedger.data) return { payment, ledgerId: String(directLedger.data.id) };

  const entryType = payment.payment_type === "advance" ? "advance" : "payment";
  const { data: fallbackLedger, error: fallbackError } = await adminSupabase
    .from("financial_ledger_entries")
    .select("id")
    .eq("employee_id", payment.employee_id)
    .eq("entry_type", entryType)
    .eq("occurred_on", payment.payment_date)
    .eq("amount", -Math.abs(Number(payment.amount)))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError) throw new Error(fallbackError.message);
  return { payment, ledgerId: fallbackLedger ? String(fallbackLedger.id) : null };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    employeeId?: string;
    paymentDate?: string;
    paymentType?: "advance" | "salary";
    amount?: number;
    comment?: string;
  };

  if (!body.employeeId || !body.paymentDate || !body.paymentType || !body.amount) {
    return NextResponse.json({ error: "Не вистачає даних для виплати." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Сума виплати має бути більшою за 0." }, { status: 400 });
  }

  try {
    await recordPayment({
      employeeId: body.employeeId,
      actorId: auth.userId,
      paymentType: body.paymentType,
      amount,
      paymentDate: body.paymentDate,
      comment: body.comment?.trim() || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося зафіксувати виплату." },
      { status: 400 }
    );
  }

  return NextResponse.json({ message: "Виплату додано." });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    paymentId?: string;
    paymentDate?: string;
    paymentType?: "advance" | "salary";
    amount?: number;
    comment?: string;
  };

  if (!body.paymentId || !body.paymentDate || !body.paymentType || !body.amount) {
    return NextResponse.json({ error: "Не вистачає даних для оновлення виплати." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Сума виплати має бути більшою за 0." }, { status: 400 });
  }

  try {
    const { payment, ledgerId } = await findPaymentAndLedger(body.paymentId);
    const normalizedComment = body.comment?.trim() || null;

    const { error: paymentUpdateError } = await adminSupabase
      .from("salary_payments")
      .update({
        payment_date: body.paymentDate,
        payment_type: body.paymentType,
        amount,
        comment: normalizedComment,
      })
      .eq("id", body.paymentId);

    if (paymentUpdateError) throw new Error(paymentUpdateError.message);

    if (ledgerId) {
      const { error: ledgerUpdateError } = await adminSupabase
        .from("financial_ledger_entries")
        .update({
          entry_type: body.paymentType === "advance" ? "advance" : "payment",
          amount: -Math.abs(amount),
          occurred_on: body.paymentDate,
          comment: normalizedComment,
          metadata: {
            paymentType: body.paymentType,
            paymentId: body.paymentId,
            previousPaymentType: payment.payment_type,
          },
          created_by: auth.userId,
        })
        .eq("id", ledgerId);

      if (ledgerUpdateError) throw new Error(ledgerUpdateError.message);
    }

    return NextResponse.json({ message: "Виплату оновлено." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося оновити виплату." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as { paymentId?: string };
  if (!body.paymentId) {
    return NextResponse.json({ error: "Не вказано paymentId." }, { status: 400 });
  }

  try {
    const { ledgerId } = await findPaymentAndLedger(body.paymentId);

    if (ledgerId) {
      const { error: ledgerDeleteError } = await adminSupabase
        .from("financial_ledger_entries")
        .delete()
        .eq("id", ledgerId);
      if (ledgerDeleteError) throw new Error(ledgerDeleteError.message);
    }

    const { error: paymentDeleteError } = await adminSupabase
      .from("salary_payments")
      .delete()
      .eq("id", body.paymentId);
    if (paymentDeleteError) throw new Error(paymentDeleteError.message);

    return NextResponse.json({ message: "Виплату видалено." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося видалити виплату." },
      { status: 400 }
    );
  }
}
