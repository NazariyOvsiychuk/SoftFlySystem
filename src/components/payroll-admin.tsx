"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDate, formatDateTime, formatHours, formatMoney } from "@/lib/format";
import { getAccessToken } from "@/lib/supabase";

type PeriodPreset = "today" | "week" | "month" | "previousMonth" | "custom";
type PaymentType = "advance" | "salary";
type AdjustmentType = "bonus" | "deduction";

type PayrollSummaryRow = {
  employeeId: string;
  fullName: string;
  email: string;
  hourlyRate: number;
  workedMinutes: number;
  grossAmount: number;
  bonusesAmount: number;
  deductionsAmount: number;
  totalDue: number;
  paidAmount: number;
  balanceAmount: number;
};

type PayrollPaymentRow = {
  id: string;
  employeeId: string;
  fullName: string;
  paymentDate: string;
  paymentType: PaymentType;
  amount: number;
  comment: string | null;
  createdAt: string;
};

type PayrollSummaryPayload = {
  rows: PayrollSummaryRow[];
  totals: {
    totalWorkedMinutes: number;
    totalGrossAmount: number;
    totalPaidAmount: number;
    totalBalanceAmount: number;
  };
};

type PayrollEmployeePayload = {
  employee: {
    id: string;
    fullName: string;
    email: string;
    hourlyRate: number;
  };
  summary: PayrollSummaryRow;
  shifts: Array<{
    id: string;
    shiftDate: string;
    startedAt: string;
    endedAt: string | null;
    durationMinutes: number;
    status: string;
  }>;
  payments: PayrollPaymentRow[];
  adjustments: Array<{
    id: string;
    effectiveDate: string;
    kind: AdjustmentType;
    amount: number;
    reason: string | null;
    createdAt: string;
  }>;
};

type PaymentFormState = {
  open: boolean;
  mode: "create" | "edit";
  paymentId: string | null;
  paymentType: PaymentType;
  paymentDate: string;
  amount: string;
  comment: string;
};

function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function toDateTimeInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function getPresetRange(preset: PeriodPreset) {
  const now = new Date();
  if (preset === "today") {
    const value = toDateInputValue(now);
    return { start: value, end: value };
  }

  if (preset === "week") {
    const day = now.getDay() || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - day + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: toDateInputValue(start), end: toDateInputValue(end) };
  }

  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: toDateInputValue(start), end: toDateInputValue(end) };
  }

  if (preset === "previousMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: toDateInputValue(start), end: toDateInputValue(end) };
  }

  return { start: toDateInputValue(now), end: toDateInputValue(now) };
}

async function callAdminJson<T>(path: string, options?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }) {
  const token = await getAccessToken();
  if (!token) {
    return { ok: false as const, error: "Немає сесії адміністратора." };
  }

  const response = await fetch(path, {
    method: options?.method ?? "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    ...(options?.method !== "GET" ? { body: JSON.stringify(options?.body ?? {}) } : {}),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    return { ok: false as const, error: payload.error ?? "Request failed." };
  }

  return { ok: true as const, data: payload };
}

function paymentTypeLabel(type: PaymentType) {
  return type === "advance" ? "Аванс" : "Зарплата";
}

function adjustmentTypeLabel(type: AdjustmentType) {
  return type === "bonus" ? "Бонус" : "Штраф";
}

export function PayrollAdminPage() {
  const initialRange = getPresetRange("month");
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [range, setRange] = useState(initialRange);
  const [activeTab, setActiveTab] = useState<"overview" | "history">("overview");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<PayrollSummaryPayload | null>(null);
  const [payments, setPayments] = useState<PayrollPaymentRow[]>([]);
  const [paymentEditor, setPaymentEditor] = useState<PaymentFormState | null>(null);

  useEffect(() => {
    if (preset === "custom") return;
    setRange(getPresetRange(preset));
  }, [preset]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMessage(null);

      const [summaryResult, historyResult] = await Promise.all([
        callAdminJson<PayrollSummaryPayload>("/api/admin/payroll/summary", { body: { periodStart: range.start, periodEnd: range.end } }),
        callAdminJson<{ payments: PayrollPaymentRow[] }>("/api/admin/payroll/history", { body: { periodStart: range.start, periodEnd: range.end } }),
      ]);

      if (!summaryResult.ok) {
        setMessage(summaryResult.error ?? "Не вдалося завантажити payroll.");
        setSummary(null);
      } else {
        setSummary(summaryResult.data);
      }

      if (!historyResult.ok) {
        setPayments([]);
        setMessage((current) => current ?? historyResult.error ?? "Не вдалося завантажити історію виплат.");
      } else {
        setPayments(historyResult.data.payments ?? []);
      }

      setLoading(false);
    }

    void load();
  }, [range.end, range.start]);

  async function handleExport() {
    const token = await getAccessToken();
    if (!token) {
      setMessage("Немає сесії адміністратора.");
      return;
    }

    const response = await fetch(
      `/api/admin/exports/payroll?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(payload.error ?? "Не вдалося сформувати payroll-експорт.");
      return;
    }

    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `payroll-${range.start}-${range.end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  async function submitPaymentUpdate() {
    if (!paymentEditor?.paymentId || !paymentEditor.amount) {
      setMessage("Вкажи коректну суму виплати.");
      return;
    }

    const result = await callAdminJson<{ message: string }>("/api/admin/payroll/payments", {
      method: "PATCH",
      body: {
        paymentId: paymentEditor.paymentId,
        paymentType: paymentEditor.paymentType,
        paymentDate: paymentEditor.paymentDate,
        amount: Number(paymentEditor.amount),
        comment: paymentEditor.comment,
      },
    });

    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося оновити виплату.");
      return;
    }

    setPaymentEditor(null);
    setMessage(result.data.message ?? "Виплату оновлено.");

    const [summaryResult, historyResult] = await Promise.all([
      callAdminJson<PayrollSummaryPayload>("/api/admin/payroll/summary", { body: { periodStart: range.start, periodEnd: range.end } }),
      callAdminJson<{ payments: PayrollPaymentRow[] }>("/api/admin/payroll/history", { body: { periodStart: range.start, periodEnd: range.end } }),
    ]);

    if (summaryResult.ok) setSummary(summaryResult.data);
    if (historyResult.ok) setPayments(historyResult.data.payments ?? []);
  }

  async function handleDeletePayment(paymentId: string) {
    if (!window.confirm("Видалити цю виплату?")) return;
    const result = await callAdminJson<{ message: string }>("/api/admin/payroll/payments", {
      method: "DELETE",
      body: { paymentId },
    });
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося видалити виплату.");
      return;
    }

    setMessage(result.data.message ?? "Виплату видалено.");

    const [summaryResult, historyResult] = await Promise.all([
      callAdminJson<PayrollSummaryPayload>("/api/admin/payroll/summary", { body: { periodStart: range.start, periodEnd: range.end } }),
      callAdminJson<{ payments: PayrollPaymentRow[] }>("/api/admin/payroll/history", { body: { periodStart: range.start, periodEnd: range.end } }),
    ]);

    if (summaryResult.ok) setSummary(summaryResult.data);
    if (historyResult.ok) setPayments(historyResult.data.payments ?? []);
  }

  const totals = summary?.totals;

  return (
    <section className="payroll-shell">
      <div className="payroll-hero">
        <div>
          <p className="eyebrow">Payroll</p>
          <h1>Зарплата та фінансовий аудит</h1>
          <p className="muted-copy">
            Погодинна оплата, часткові виплати, аванси та прозорий баланс по кожному працівнику.
          </p>
        </div>

        <div className="payroll-actions">
          <button className="button button-secondary" type="button" onClick={handleExport}>
            Експорт CSV
          </button>
        </div>
      </div>

      <section className="panel payroll-toolbar">
        <div className="segmented-control">
          {[
            ["today", "Сьогодні"],
            ["week", "Цей тиждень"],
            ["month", "Цей місяць"],
            ["previousMonth", "Попередній місяць"],
            ["custom", "Довільний"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={preset === value ? "segment active" : "segment"}
              onClick={() => setPreset(value as PeriodPreset)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="payroll-date-grid">
          <label className="field">
            <span>Початок</span>
            <input type="date" value={range.start} onChange={(e) => setRange((current) => ({ ...current, start: e.target.value }))} />
          </label>
          <label className="field">
            <span>Кінець</span>
            <input type="date" value={range.end} onChange={(e) => setRange((current) => ({ ...current, end: e.target.value }))} />
          </label>
        </div>
      </section>

      {message ? <section className="panel notice-panel">{message}</section> : null}

      <section className="stats-grid payroll-metrics-grid">
        <article className="stat-card">
          <span>Нараховано</span>
          <strong>{formatMoney(totals?.totalGrossAmount ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Виплачено</span>
          <strong>{formatMoney(totals?.totalPaidAmount ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Баланс компанії</span>
          <strong>{formatMoney(totals?.totalBalanceAmount ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Відпрацьовано</span>
          <strong>{formatHours(totals?.totalWorkedMinutes ?? 0)}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="payroll-tabbar">
          <button
            type="button"
            className={activeTab === "overview" ? "button button-primary" : "button button-secondary"}
            onClick={() => setActiveTab("overview")}
          >
            Працівники
          </button>
          <button
            type="button"
            className={activeTab === "history" ? "button button-primary" : "button button-secondary"}
            onClick={() => setActiveTab("history")}
          >
            Історія виплат
          </button>
        </div>

        {loading ? <p>Завантажуємо payroll-дані...</p> : null}

        {!loading && activeTab === "overview" ? (
          <div className="schedule-table">
            <div className="table-row header payroll-summary-row">
              <strong>Працівник</strong>
              <span>Ставка</span>
              <span>Години</span>
              <span>Нараховано</span>
              <span>Бонуси / штрафи</span>
              <span>До виплати</span>
              <span>Виплачено</span>
              <span>Залишок</span>
            </div>

            {(summary?.rows ?? []).map((row) => (
              <Link
                key={row.employeeId}
                href={`/admin/payroll/${row.employeeId}?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`}
                className="table-row payroll-summary-row payroll-row-link"
              >
                <strong>{row.fullName}</strong>
                <span>{formatMoney(row.hourlyRate)}</span>
                <span>{formatHours(row.workedMinutes)}</span>
                <span>{formatMoney(row.grossAmount)}</span>
                <span>
                  +{formatMoney(row.bonusesAmount)} / -{formatMoney(row.deductionsAmount)}
                </span>
                <span>{formatMoney(row.totalDue)}</span>
                <span>{formatMoney(row.paidAmount)}</span>
                <span className="money-strong">{formatMoney(row.balanceAmount)}</span>
              </Link>
            ))}

            {!summary?.rows?.length ? <p className="hint">За обраний період працівників або даних ще немає.</p> : null}
          </div>
        ) : null}

        {!loading && activeTab === "history" ? (
          <div className="schedule-table">
            <div className="table-row header payroll-history-row">
              <strong>Працівник</strong>
              <span>Дата</span>
              <span>Тип</span>
              <span>Сума</span>
              <span>Коментар</span>
              <span>Дії</span>
            </div>

            {payments.map((payment) => (
              <div key={payment.id} className="table-row payroll-history-row">
                <strong>{payment.fullName}</strong>
                <span>{formatDate(payment.paymentDate)}</span>
                <span>{paymentTypeLabel(payment.paymentType)}</span>
                <span>{formatMoney(payment.amount)}</span>
                <span>{payment.comment || "Без коментаря"}</span>
                <span className="row-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      setPaymentEditor({
                        open: true,
                        mode: "edit",
                        paymentId: payment.id,
                        paymentType: payment.paymentType,
                        paymentDate: payment.paymentDate,
                        amount: String(payment.amount),
                        comment: payment.comment ?? "",
                      })
                    }
                  >
                    Змінити
                  </button>
                  <button type="button" className="button button-danger" onClick={() => handleDeletePayment(payment.id)}>
                    Видалити
                  </button>
                </span>
              </div>
            ))}

            {!payments.length ? <p className="hint">За обраний період виплат ще не було.</p> : null}
          </div>
        ) : null}
      </section>

      {paymentEditor?.open ? (
        <>
          <button type="button" className="popover-scrim" onClick={() => setPaymentEditor(null)} />
          <div className="panel popover payroll-modal">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Редагування виплати</p>
                <h2>Оновити аванс або зарплату</h2>
              </div>
            </div>
            <label className="field">
              <span>Тип виплати</span>
              <select value={paymentEditor.paymentType} onChange={(e) => setPaymentEditor((current) => current ? { ...current, paymentType: e.target.value as PaymentType } : current)}>
                <option value="advance">Аванс</option>
                <option value="salary">Зарплата</option>
              </select>
            </label>
            <label className="field">
              <span>Дата</span>
              <input type="date" value={paymentEditor.paymentDate} onChange={(e) => setPaymentEditor((current) => current ? { ...current, paymentDate: e.target.value } : current)} />
            </label>
            <label className="field">
              <span>Сума</span>
              <input type="number" step="0.01" value={paymentEditor.amount} onChange={(e) => setPaymentEditor((current) => current ? { ...current, amount: e.target.value } : current)} />
            </label>
            <label className="field">
              <span>Коментар</span>
              <input value={paymentEditor.comment} onChange={(e) => setPaymentEditor((current) => current ? { ...current, comment: e.target.value } : current)} />
            </label>
            <div className="field-row">
              <button type="button" className="button button-primary full-width" onClick={submitPaymentUpdate}>
                Зберегти зміни
              </button>
              <button type="button" className="button button-secondary full-width" onClick={() => setPaymentEditor(null)}>
                Скасувати
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function PayrollEmployeePage(props: {
  employeeId: string;
  initialStart: string;
  initialEnd: string;
}) {
  const [range, setRange] = useState({ start: props.initialStart, end: props.initialEnd });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<PayrollEmployeePayload | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    open: false,
    mode: "create" as "create" | "edit",
    paymentId: null as string | null,
    paymentType: "advance" as PaymentType,
    paymentDate: props.initialEnd,
    amount: "",
    comment: "",
  });
  const [adjustmentForm, setAdjustmentForm] = useState<{
    open: boolean;
    kind: AdjustmentType;
    effectiveDate: string;
    amount: string;
    reason: string;
  }>({
    open: false,
    kind: "bonus",
    effectiveDate: props.initialEnd,
    amount: "",
    reason: "",
  });
  const [shiftEditor, setShiftEditor] = useState<{
    mode: "create" | "edit";
    shiftId?: string;
    startedAt: string;
    endedAt: string;
    status: "open" | "closed" | "flagged";
  } | null>(null);

  async function load() {
    setLoading(true);
    setMessage(null);
    const result = await callAdminJson<PayrollEmployeePayload>("/api/admin/payroll/employee", {
      body: { employeeId: props.employeeId, periodStart: range.start, periodEnd: range.end },
    });

    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося завантажити payroll-дані працівника.");
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [range.end, range.start]);

  async function submitPayment() {
    if (!paymentForm.amount) {
      setMessage("Вкажи суму виплати.");
      return;
    }

    const result = await callAdminJson<{ message: string }>("/api/admin/payroll/payments", paymentForm.mode === "create"
      ? {
          body: {
            employeeId: props.employeeId,
            paymentType: paymentForm.paymentType,
            paymentDate: paymentForm.paymentDate,
            amount: Number(paymentForm.amount),
            comment: paymentForm.comment,
          },
        }
      : {
          method: "PATCH",
          body: {
            paymentId: paymentForm.paymentId,
            paymentType: paymentForm.paymentType,
            paymentDate: paymentForm.paymentDate,
            amount: Number(paymentForm.amount),
            comment: paymentForm.comment,
          },
        });

    if (!result.ok) {
      setMessage(result.error ?? (paymentForm.mode === "create" ? "Не вдалося додати виплату." : "Не вдалося оновити виплату."));
      return;
    }

    setPaymentForm({
      open: false,
      mode: "create",
      paymentId: null,
      paymentType: "advance",
      paymentDate: range.end,
      amount: "",
      comment: "",
    });
    await load();
  }

  async function submitAdjustment() {
    if (!adjustmentForm.amount) {
      setMessage("Вкажи суму бонусу або штрафу.");
      return;
    }

    const result = await callAdminJson<{ message: string }>("/api/admin/payroll/adjustments", {
      body: {
        employeeId: props.employeeId,
        kind: adjustmentForm.kind,
        effectiveDate: adjustmentForm.effectiveDate,
        amount: Number(adjustmentForm.amount),
        reason: adjustmentForm.reason,
      },
    });

    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося зберегти коригування.");
      return;
    }

    setAdjustmentForm({
      open: false,
      kind: "bonus",
      effectiveDate: range.end,
      amount: "",
      reason: "",
    });
    setMessage(result.data.message ?? "Коригування додано.");
    await load();
  }

  async function handleDeletePayment(paymentId: string) {
    if (!window.confirm("Видалити цю виплату?")) return;
    const result = await callAdminJson<{ message: string }>("/api/admin/payroll/payments", {
      method: "DELETE",
      body: { paymentId },
    });
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося видалити виплату.");
      return;
    }
    await load();
  }

  async function submitShiftEditor() {
    if (!shiftEditor) return;

    const route = shiftEditor.mode === "create" ? "/api/admin/shifts/create" : "/api/admin/shifts/update";
    const payload =
      shiftEditor.mode === "create"
        ? {
            employeeId: props.employeeId,
            startedAt: new Date(shiftEditor.startedAt).toISOString(),
            endedAt: shiftEditor.endedAt ? new Date(shiftEditor.endedAt).toISOString() : null,
            status: shiftEditor.status,
          }
        : {
            shiftId: shiftEditor.shiftId,
            startedAt: new Date(shiftEditor.startedAt).toISOString(),
            endedAt: shiftEditor.endedAt ? new Date(shiftEditor.endedAt).toISOString() : null,
            status: shiftEditor.status,
          };

    const result = await callAdminJson<{ message: string }>(route, { body: payload });
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося зберегти зміну.");
      return;
    }

    setShiftEditor(null);
    await load();
  }

  async function handleDeleteShift(shiftId: string) {
    if (!window.confirm("Видалити цю зміну?")) return;
    const result = await callAdminJson<{ message: string }>("/api/admin/shifts/delete", {
      body: { shiftId },
    });
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося видалити зміну.");
      return;
    }
    await load();
  }

  const summary = data?.summary;
  const netAdjustments = useMemo(
    () => (summary ? summary.bonusesAmount - summary.deductionsAmount : 0),
    [summary]
  );

  return (
    <section className="payroll-shell">
      <div className="payroll-hero">
        <div>
          <Link href={`/admin/payroll?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`} className="eyebrow-link">
            Назад до зарплати
          </Link>
          <h1>{data?.employee.fullName ?? "Працівник"}</h1>
          <p className="muted-copy">
            {data?.employee.email ?? ""} · ставка {formatMoney(data?.employee.hourlyRate ?? 0)}
          </p>
        </div>

        <div className="payroll-date-grid compact">
          <label className="field">
            <span>Початок</span>
            <input type="date" value={range.start} onChange={(e) => setRange((current) => ({ ...current, start: e.target.value }))} />
          </label>
          <label className="field">
            <span>Кінець</span>
            <input type="date" value={range.end} onChange={(e) => setRange((current) => ({ ...current, end: e.target.value }))} />
          </label>
        </div>
      </div>

      {message ? <section className="panel notice-panel">{message}</section> : null}

      <section className="stats-grid payroll-metrics-grid">
        <article className="stat-card">
          <span>Відпрацьовано</span>
          <strong>{formatHours(summary?.workedMinutes ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Нараховано</span>
          <strong>{formatMoney(summary?.grossAmount ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Вже виплачено</span>
          <strong>{formatMoney(summary?.paidAmount ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Залишок</span>
          <strong>{formatMoney(summary?.balanceAmount ?? 0)}</strong>
        </article>
      </section>

      <section className="grid payroll-detail-grid">
        <article className="panel large">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Зміни</p>
              <h2>Історія змін за період</h2>
            </div>
            <button
              type="button"
              className="button button-primary"
              onClick={() =>
                setShiftEditor({
                  mode: "create",
                  startedAt: `${range.start}T09:00`,
                  endedAt: `${range.start}T18:00`,
                  status: "closed",
                })
              }
            >
              Додати зміну
            </button>
          </div>

          {loading ? <p>Завантажуємо зміни...</p> : null}

          {!loading ? (
            <div className="schedule-table">
              <div className="table-row header employee-shifts-row">
                <strong>Дата</strong>
                <span>Check-in</span>
                <span>Check-out</span>
                <span>Тривалість</span>
                <span>Дії</span>
              </div>
              {(data?.shifts ?? []).map((shift) => (
                <div key={shift.id} className="table-row employee-shifts-row">
                  <strong>{formatDate(shift.shiftDate)}</strong>
                  <span>{formatDateTime(shift.startedAt)}</span>
                  <span>{shift.endedAt ? formatDateTime(shift.endedAt) : "Відкрита зміна"}</span>
                  <span>{formatHours(shift.durationMinutes)}</span>
                  <span className="row-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        setShiftEditor({
                          mode: "edit",
                          shiftId: shift.id,
                          startedAt: toDateTimeInputValue(shift.startedAt),
                          endedAt: toDateTimeInputValue(shift.endedAt),
                          status: shift.status as "open" | "closed" | "flagged",
                        })
                      }
                    >
                      Редагувати
                    </button>
                    <button type="button" className="button button-danger" onClick={() => handleDeleteShift(shift.id)}>
                      Видалити
                    </button>
                  </span>
                </div>
              ))}
              {!data?.shifts?.length ? <p className="hint">За обраний період змін немає.</p> : null}
            </div>
          ) : null}

          <div className="payroll-finance-summary">
            <div>
              <span>Загальні години</span>
              <strong>{formatHours(summary?.workedMinutes ?? 0)}</strong>
            </div>
            <div>
              <span>Погодинна ставка</span>
              <strong>{formatMoney(data?.employee.hourlyRate ?? 0)}</strong>
            </div>
            <div>
              <span>Бонуси / штрафи</span>
              <strong>
                {formatMoney(summary?.bonusesAmount ?? 0)} / {formatMoney(summary?.deductionsAmount ?? 0)}
              </strong>
            </div>
            <div>
              <span>Фінальна сума</span>
              <strong>{formatMoney((summary?.grossAmount ?? 0) + netAdjustments)}</strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Виплати</p>
              <h2>Історія виплат</h2>
            </div>
            <button type="button" className="button button-primary" onClick={() => setPaymentForm((current) => ({ ...current, open: true }))}>
              Додати виплату
            </button>
          </div>

          <div className="schedule-table">
            {(data?.payments ?? []).map((payment) => (
              <div key={payment.id} className="table-row stack">
                <strong>{formatDate(payment.paymentDate)}</strong>
                <span>{paymentTypeLabel(payment.paymentType)}</span>
                <span>{formatMoney(payment.amount)}</span>
                <span>{payment.comment || "Без коментаря"}</span>
                <span className="row-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      setPaymentForm({
                        open: true,
                        mode: "edit",
                        paymentId: payment.id,
                        paymentType: payment.paymentType,
                        paymentDate: payment.paymentDate,
                        amount: String(payment.amount),
                        comment: payment.comment ?? "",
                      })
                    }
                  >
                    Змінити
                  </button>
                  <button type="button" className="button button-danger" onClick={() => handleDeletePayment(payment.id)}>
                    Видалити
                  </button>
                </span>
              </div>
            ))}
            {!data?.payments?.length ? <p className="hint">За цей період виплат ще не було.</p> : null}
          </div>

          <div className="panel-head payroll-subsection-head">
            <div>
              <p className="eyebrow">Коригування</p>
              <h2>Бонуси та штрафи</h2>
            </div>
            <button type="button" className="button button-secondary" onClick={() => setAdjustmentForm((current) => ({ ...current, open: true }))}>
              Додати бонус / штраф
            </button>
          </div>

          <div className="schedule-table">
            {(data?.adjustments ?? []).map((adjustment) => (
              <div key={adjustment.id} className="table-row stack">
                <strong>{formatDate(adjustment.effectiveDate)}</strong>
                <span>{adjustmentTypeLabel(adjustment.kind)}</span>
                <span>{formatMoney(adjustment.amount)}</span>
                <span>{adjustment.reason || "Без коментаря"}</span>
              </div>
            ))}
            {!data?.adjustments?.length ? <p className="hint">За цей період бонусів або штрафів ще не було.</p> : null}
          </div>
        </article>
      </section>

      {paymentForm.open ? (
        <>
          <button type="button" className="popover-scrim" onClick={() => setPaymentForm((current) => ({ ...current, open: false }))} />
          <div className="panel popover payroll-modal">
            <div className="panel-head">
              <div>
                <p className="eyebrow">{paymentForm.mode === "create" ? "Нова виплата" : "Редагування виплати"}</p>
                <h2>{paymentForm.mode === "create" ? "Додати аванс або зарплату" : "Оновити аванс або зарплату"}</h2>
              </div>
            </div>
            <label className="field">
              <span>Тип виплати</span>
              <select value={paymentForm.paymentType} onChange={(e) => setPaymentForm((current) => ({ ...current, paymentType: e.target.value as PaymentType }))}>
                <option value="advance">Аванс</option>
                <option value="salary">Зарплата</option>
              </select>
            </label>
            <label className="field">
              <span>Дата</span>
              <input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((current) => ({ ...current, paymentDate: e.target.value }))} />
            </label>
            <label className="field">
              <span>Сума</span>
              <input type="number" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((current) => ({ ...current, amount: e.target.value }))} />
            </label>
            {paymentForm.mode === "create" && paymentForm.paymentType === "salary" ? (
              <button
                type="button"
                className="button button-secondary full-width"
                onClick={() =>
                  setPaymentForm((current) => ({
                    ...current,
                    amount: String(Math.max(0, Number((summary?.balanceAmount ?? 0).toFixed(2)))),
                  }))
                }
              >
                Підставити суму для закриття в нуль
              </button>
            ) : null}
            <label className="field">
              <span>Коментар</span>
              <input value={paymentForm.comment} onChange={(e) => setPaymentForm((current) => ({ ...current, comment: e.target.value }))} />
            </label>
            <div className="field-row">
              <button type="button" className="button button-primary full-width" onClick={submitPayment}>
                {paymentForm.mode === "create" ? "Зберегти виплату" : "Зберегти зміни"}
              </button>
              <button
                type="button"
                className="button button-secondary full-width"
                onClick={() =>
                  setPaymentForm({
                    open: false,
                    mode: "create",
                    paymentId: null,
                    paymentType: "advance",
                    paymentDate: range.end,
                    amount: "",
                    comment: "",
                  })
                }
              >
                Скасувати
              </button>
            </div>
          </div>
        </>
      ) : null}

      {shiftEditor ? (
        <>
          <button type="button" className="popover-scrim" onClick={() => setShiftEditor(null)} />
          <div className="panel popover payroll-modal">
            <div className="panel-head">
              <div>
                <p className="eyebrow">{shiftEditor.mode === "create" ? "Нова зміна" : "Редагування зміни"}</p>
                <h2>{data?.employee.fullName ?? "Працівник"}</h2>
              </div>
            </div>
            <label className="field">
              <span>Check-in</span>
              <input type="datetime-local" value={shiftEditor.startedAt} onChange={(e) => setShiftEditor((current) => current ? { ...current, startedAt: e.target.value } : current)} />
            </label>
            <label className="field">
              <span>Check-out</span>
              <input type="datetime-local" value={shiftEditor.endedAt} onChange={(e) => setShiftEditor((current) => current ? { ...current, endedAt: e.target.value } : current)} />
            </label>
            <label className="field">
              <span>Статус</span>
              <select value={shiftEditor.status} onChange={(e) => setShiftEditor((current) => current ? { ...current, status: e.target.value as "open" | "closed" | "flagged" } : current)}>
                <option value="closed">Закрита</option>
                <option value="open">Відкрита</option>
                <option value="flagged">Проблемна</option>
              </select>
            </label>
            <div className="field-row">
              <button type="button" className="button button-primary full-width" onClick={submitShiftEditor}>
                Зберегти
              </button>
              <button type="button" className="button button-secondary full-width" onClick={() => setShiftEditor(null)}>
                Скасувати
              </button>
            </div>
          </div>
        </>
      ) : null}

      {adjustmentForm.open ? (
        <>
          <button type="button" className="popover-scrim" onClick={() => setAdjustmentForm((current) => ({ ...current, open: false }))} />
          <div className="panel popover payroll-modal">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Коригування</p>
                <h2>Додати бонус або штраф</h2>
              </div>
            </div>
            <label className="field">
              <span>Тип</span>
              <select value={adjustmentForm.kind} onChange={(e) => setAdjustmentForm((current) => ({ ...current, kind: e.target.value as AdjustmentType }))}>
                <option value="bonus">Бонус</option>
                <option value="deduction">Штраф</option>
              </select>
            </label>
            <label className="field">
              <span>Дата</span>
              <input type="date" value={adjustmentForm.effectiveDate} onChange={(e) => setAdjustmentForm((current) => ({ ...current, effectiveDate: e.target.value }))} />
            </label>
            <label className="field">
              <span>Сума</span>
              <input type="number" step="0.01" value={adjustmentForm.amount} onChange={(e) => setAdjustmentForm((current) => ({ ...current, amount: e.target.value }))} />
            </label>
            <label className="field">
              <span>Коментар</span>
              <input value={adjustmentForm.reason} onChange={(e) => setAdjustmentForm((current) => ({ ...current, reason: e.target.value }))} />
            </label>
            <div className="field-row">
              <button type="button" className="button button-primary full-width" onClick={submitAdjustment}>
                Зберегти
              </button>
              <button
                type="button"
                className="button button-secondary full-width"
                onClick={() =>
                  setAdjustmentForm({
                    open: false,
                    kind: "bonus",
                    effectiveDate: range.end,
                    amount: "",
                    reason: "",
                  })
                }
              >
                Скасувати
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
