import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";
import { buildProfitabilitySnapshot } from "@/lib/profitability-admin";

type BatchInput = {
  id?: string;
  batchStart?: string;
  batchEnd?: string;
  batchLabel?: string;
  quantity?: number;
  unitPrice?: number;
  note?: string;
};

type CostInput = {
  id?: string;
  periodStart?: string;
  periodEnd?: string;
  category?: "rent" | "utilities" | "other";
  amount?: number;
  note?: string;
};

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

function numberValue(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function cleanText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const periodStart = String(searchParams.get("start") ?? "");
  const periodEnd = String(searchParams.get("end") ?? "");

  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "Потрібні start та end." }, { status: 400 });
  }

  try {
    const snapshot = await buildProfitabilitySnapshot(periodStart, periodEnd);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося побудувати зведення маржинальності." },
      { status: 400 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    periodStart?: string;
    periodEnd?: string;
    batches?: BatchInput[];
    costs?: CostInput[];
  };

  const periodStart = cleanText(body.periodStart);
  const periodEnd = cleanText(body.periodEnd);
  const batches = Array.isArray(body.batches) ? body.batches : [];
  const costs = Array.isArray(body.costs) ? body.costs : [];

  try {
    const [existingBatchesResult, existingCostsResult] = await Promise.all([
      adminSupabase.from("production_batches").select("id"),
      adminSupabase.from("operating_cost_entries").select("id"),
    ]);

    if (existingBatchesResult.error) throw new Error(existingBatchesResult.error.message);
    if (existingCostsResult.error) throw new Error(existingCostsResult.error.message);

    const batchIdsToKeep = new Set<string>();

    for (const batch of batches) {
      const batchStart = cleanText(batch.batchStart);
      const batchEnd = cleanText(batch.batchEnd || batch.batchStart);
      if (!isValidDate(batchStart) || !isValidDate(batchEnd)) {
        throw new Error("У партії вказаний некоректний період.");
      }
      if (batchEnd < batchStart) {
        throw new Error("Дата завершення партії не може бути раніше за дату початку.");
      }

      const payload = {
        batch_start: batchStart,
        batch_end: batchEnd,
        work_date: batchStart,
        batch_label: cleanText(batch.batchLabel, "Партія"),
        quantity: Math.max(0, numberValue(batch.quantity)),
        unit_price: Math.max(0, numberValue(batch.unitPrice)),
        note: cleanText(batch.note) || null,
      };

      if (batch.id) {
        const { error } = await adminSupabase.from("production_batches").update(payload).eq("id", batch.id);
        if (error) throw new Error(error.message);
        batchIdsToKeep.add(batch.id);
      } else {
        const { data, error } = await adminSupabase
          .from("production_batches")
          .insert({ ...payload, created_by: auth.userId })
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "Не вдалося створити запис партії.");
        batchIdsToKeep.add(String(data.id));
      }
    }

    const batchIdsToDelete = (existingBatchesResult.data ?? [])
      .map((row) => String(row.id))
      .filter((id) => !batchIdsToKeep.has(id));

    if (batchIdsToDelete.length) {
      const { error } = await adminSupabase.from("production_batches").delete().in("id", batchIdsToDelete);
      if (error) throw new Error(error.message);
    }

    const costIdsToKeep = new Set<string>();

    for (const cost of costs) {
      const periodStart = cleanText(cost.periodStart);
      const periodEnd = cleanText(cost.periodEnd);
      if (!isValidDate(periodStart) || !isValidDate(periodEnd)) {
        throw new Error("У витратах вказаний некоректний період.");
      }
      if (periodEnd < periodStart) {
        throw new Error("Дата завершення витрати не може бути раніше за дату початку.");
      }

      const category =
        cost.category === "rent" || cost.category === "utilities" || cost.category === "other"
          ? cost.category
          : "other";

      const payload = {
        period_start: periodStart,
        period_end: periodEnd,
        category,
        amount: Math.max(0, numberValue(cost.amount)),
        note: cleanText(cost.note) || null,
      };

      if (cost.id) {
        const { error } = await adminSupabase.from("operating_cost_entries").update(payload).eq("id", cost.id);
        if (error) throw new Error(error.message);
        costIdsToKeep.add(cost.id);
      } else {
        const { data, error } = await adminSupabase
          .from("operating_cost_entries")
          .insert({ ...payload, created_by: auth.userId })
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "Не вдалося створити запис витрати.");
        costIdsToKeep.add(String(data.id));
      }
    }

    const costIdsToDelete = (existingCostsResult.data ?? [])
      .map((row) => String(row.id))
      .filter((id) => !costIdsToKeep.has(id));

    if (costIdsToDelete.length) {
      const { error } = await adminSupabase.from("operating_cost_entries").delete().in("id", costIdsToDelete);
      if (error) throw new Error(error.message);
    }

    const responsePayload: Record<string, unknown> = {
      message: "Маржинальність і витрати збережено.",
    };

    if (isValidDate(periodStart) && isValidDate(periodEnd)) {
      responsePayload.snapshot = await buildProfitabilitySnapshot(periodStart, periodEnd);
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося зберегти маржинальність." },
      { status: 400 }
    );
  }
}
