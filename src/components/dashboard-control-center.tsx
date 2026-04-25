"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCompactMoney, formatDateTime, formatHours, formatMoney } from "@/lib/format";
import { getAccessToken, supabase } from "@/lib/supabase";

type PeriodPreset = "today" | "week" | "month" | "custom";
type QuickAction = "manualShift" | "employee" | "advance" | "runPayroll" | "closePayroll" | null;

type DashboardPayload = {
  employees: Array<{ id: string; fullName: string; email: string; hourlyRate: number }>;
  kpis: {
    activeEmployees: number;
    onShiftNow: number;
    todayWorkedMinutes: number;
    accruedForPeriod: number;
    paidForPeriod: number;
    outstandingLiability: number;
  };
  activeNow: Array<{
    shiftId: string;
    employeeId: string;
    fullName: string;
    startedAt: string;
    liveMinutes: number;
    liveEarnings: number;
    hourlyRate: number;
  }>;
  todayActivity: {
    totalCheckIns: number;
    totalCheckOuts: number;
    averageShiftMinutes: number;
    totalAccrualToday: number;
  };
  payrollOverview: {
    accrued: number;
    advances: number;
    paid: number;
    liability: number;
    employeesWithDebt: number;
  };
  alerts: Array<{
    kind: string;
    title: string;
    description: string;
    href: string;
    severity: string;
  }>;
  trends: Array<{
    day: string;
    payrollAmount: number;
    workedMinutes: number;
    activeCount: number;
  }>;
};

function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

async function callAdmin<T>(path: string, body: unknown) {
  const token = await getAccessToken();
  if (!token) return { ok: false as const, error: "Немає сесії адміністратора." };

  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string; payrollRunId?: string };
  if (!response.ok) return { ok: false as const, error: payload.error ?? "Request failed." };
  return { ok: true as const, data: payload };
}

function maxOf(values: number[]) {
  return values.length ? Math.max(...values, 1) : 1;
}

export function DashboardControlCenter() {
  const initialRange = getPresetRange("today");
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [range, setRange] = useState(initialRange);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [, setTick] = useState(0);
  const [quickAction, setQuickAction] = useState<QuickAction>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastPayrollRunId, setLastPayrollRunId] = useState<string | null>(null);

  const [manualShiftForm, setManualShiftForm] = useState({
    employeeId: "",
    action: "start" as "start" | "finish",
  });
  const [employeeForm, setEmployeeForm] = useState({
    fullName: "",
    email: "",
    password: "",
    hourlyRate: "0",
  });
  const [advanceForm, setAdvanceForm] = useState({
    employeeId: "",
    paymentDate: initialRange.end,
    amount: "",
    comment: "",
  });

  async function loadDashboard() {
    setLoading(true);
    const result = await callAdmin<DashboardPayload>("/api/admin/dashboard", {
      start: range.start,
      end: range.end,
    });
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося завантажити dashboard.");
      setData(null);
    } else {
      setMessage(null);
      setData(result.data);
      setManualShiftForm((current) => ({
        ...current,
        employeeId: current.employeeId || result.data.employees[0]?.id || "",
      }));
      setAdvanceForm((current) => ({
        ...current,
        employeeId: current.employeeId || result.data.employees[0]?.id || "",
      }));
    }
    setLoading(false);
  }

  useEffect(() => {
    if (preset === "custom") return;
    setRange(getPresetRange(preset));
  }, [preset]);

  useEffect(() => {
    void loadDashboard();
  }, [range.end, range.start]);

  useEffect(() => {
    const ticker = window.setInterval(() => setTick((value) => value + 1), 60000);
    return () => window.clearInterval(ticker);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`dashboard-live-${range.start}-${range.end}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => void loadDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "salary_payments" }, () => void loadDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "pay_adjustments" }, () => void loadDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void loadDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_settings" }, () => void loadDashboard())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [range.end, range.start]);

  const trendMaxPayroll = useMemo(() => maxOf((data?.trends ?? []).map((item) => item.payrollAmount)), [data]);
  const trendMaxHours = useMemo(() => maxOf((data?.trends ?? []).map((item) => item.workedMinutes)), [data]);

  async function submitManualShift() {
    setSubmitting(true);
    const result = await callAdmin<{ message: string }>("/api/admin/manual-shift", manualShiftForm);
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося змінити стан зміни.");
      return;
    }
    setQuickAction(null);
    setMessage(result.data.message ?? "Дію виконано.");
    await loadDashboard();
  }

  async function submitEmployee() {
    setSubmitting(true);
    const result = await callAdmin<{ message: string }>("/api/admin/employees", {
      fullName: employeeForm.fullName,
      email: employeeForm.email,
      password: employeeForm.password,
      hourlyRate: Number(employeeForm.hourlyRate),
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося створити працівника.");
      return;
    }
    setQuickAction(null);
    setEmployeeForm({ fullName: "", email: "", password: "", hourlyRate: "0" });
    setMessage(result.data.message ?? "Працівника створено.");
    await loadDashboard();
  }

  async function submitAdvance() {
    setSubmitting(true);
    const result = await callAdmin<{ message: string }>("/api/admin/payroll/payments", {
      employeeId: advanceForm.employeeId,
      paymentType: "advance",
      paymentDate: advanceForm.paymentDate,
      amount: Number(advanceForm.amount),
      comment: advanceForm.comment,
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося додати аванс.");
      return;
    }
    setQuickAction(null);
    setAdvanceForm((current) => ({ ...current, amount: "", comment: "" }));
    setMessage(result.data.message ?? "Аванс додано.");
    await loadDashboard();
  }

  async function submitPayrollRun() {
    setSubmitting(true);
    const result = await callAdmin<{ message: string; payrollRunId?: string }>("/api/admin/payroll/run/create", {
      periodStart: range.start,
      periodEnd: range.end,
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося створити payroll run.");
      return;
    }
    setLastPayrollRunId(result.data.payrollRunId ?? null);
    setQuickAction(null);
    setMessage(result.data.message ?? "Payroll run створено.");
  }

  async function submitClosePayroll() {
    setSubmitting(true);
    const result = await callAdmin<{ message: string }>("/api/admin/payroll/run/close", {
      payrollRunId: lastPayrollRunId,
      periodStart: range.start,
      periodEnd: range.end,
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося закрити payroll-період.");
      return;
    }
    setQuickAction(null);
    setMessage(result.data.message ?? "Період закрито.");
    await loadDashboard();
  }

  async function exportPayroll() {
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
      setMessage(payload.error ?? "Не вдалося виконати експорт.");
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `dashboard-payroll-${range.start}-${range.end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  return (
    <section className="control-center-shell">
      <div className="control-center-hero">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Контрольний центр компанії</h1>
          <p className="muted-copy">
            Відповідь за 10 секунд: хто зараз працює, скільки вже витрачено на персонал і де є ризики.
          </p>
        </div>

        <div className="hero-actions">
          <button type="button" className="button button-primary" onClick={() => setQuickAction("manualShift")}>
            Створити зміну вручну
          </button>
          <button type="button" className="button button-secondary" onClick={() => setQuickAction("employee")}>
            Додати працівника
          </button>
          <button type="button" className="button button-secondary" onClick={() => setQuickAction("advance")}>
            Додати аванс
          </button>
          <button type="button" className="button button-secondary" onClick={() => setQuickAction("runPayroll")}>
            Запустити payroll run
          </button>
          <button type="button" className="button button-secondary" onClick={() => setQuickAction("closePayroll")}>
            Закрити період зарплати
          </button>
          <button type="button" className="button button-secondary" onClick={exportPayroll}>
            Експорт даних
          </button>
        </div>
      </div>

      <section className="panel control-toolbar">
        <div className="segmented-control">
          {[
            ["today", "Сьогодні"],
            ["week", "Тиждень"],
            ["month", "Місяць"],
            ["custom", "Довільно"],
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
      </section>

      {message ? <section className="panel notice-panel">{message}</section> : null}

      <section className="stats-grid control-kpis-grid">
        <article className="stat-card">
          <span>Активні працівники</span>
          <strong>{data?.kpis.activeEmployees ?? 0}</strong>
        </article>
        <article className="stat-card">
          <span>На зміні зараз</span>
          <strong>{data?.kpis.onShiftNow ?? 0}</strong>
        </article>
        <article className="stat-card">
          <span>Години сьогодні</span>
          <strong>{formatHours(data?.kpis.todayWorkedMinutes ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Нараховано за період</span>
          <strong>{formatCompactMoney(data?.kpis.accruedForPeriod ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Виплачено</span>
          <strong>{formatCompactMoney(data?.kpis.paidForPeriod ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Борг компанії перед працівниками</span>
          <strong>{formatCompactMoney(data?.kpis.outstandingLiability ?? 0)}</strong>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel large">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Активність зараз</p>
              <h2>Хто зараз працює</h2>
            </div>
            <div className="panel-actions">
              <Link href="/admin/time" className="button button-secondary button-compact">
                Відкрити check-in/out
              </Link>
            </div>
          </div>

          {loading ? <p>Оновлюємо live-стан...</p> : null}

          {!loading ? (
            <div className="schedule-table">
              {(data?.activeNow ?? []).map((row) => (
                <div key={row.shiftId} className="table-row control-active-row">
                  <strong>{row.fullName}</strong>
                  <span>{formatDateTime(row.startedAt)}</span>
                  <span>{formatHours(row.liveMinutes)}</span>
                  <span className="money-strong">{formatMoney(row.liveEarnings)}</span>
                </div>
              ))}
              {!data?.activeNow?.length ? <p className="hint">Зараз немає активних змін.</p> : null}
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Сьогодні</p>
              <h2>Сьогоднішня активність</h2>
            </div>
          </div>
          <div className="control-mini-stats">
            <div>
              <span>Check-ins</span>
              <strong>{data?.todayActivity.totalCheckIns ?? 0}</strong>
            </div>
            <div>
              <span>Check-outs</span>
              <strong>{data?.todayActivity.totalCheckOuts ?? 0}</strong>
            </div>
            <div>
              <span>Сер. тривалість</span>
              <strong>{formatHours(data?.todayActivity.averageShiftMinutes ?? 0)}</strong>
            </div>
            <div>
              <span>Нараховано сьогодні</span>
              <strong>{formatCompactMoney(data?.todayActivity.totalAccrualToday ?? 0)}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Зарплата</p>
              <h2>Фінансовий стан</h2>
            </div>
            <div className="panel-actions">
              <Link href="/admin/payroll" className="button button-secondary button-compact">
                Відкрити зарплату
              </Link>
            </div>
          </div>
          <div className="control-mini-stats">
            <div>
              <span>Нараховано</span>
              <strong>{formatCompactMoney(data?.payrollOverview.accrued ?? 0)}</strong>
            </div>
            <div>
              <span>Аванси</span>
              <strong>{formatCompactMoney(data?.payrollOverview.advances ?? 0)}</strong>
            </div>
            <div>
              <span>Виплати</span>
              <strong>{formatCompactMoney(data?.payrollOverview.paid ?? 0)}</strong>
            </div>
            <div>
              <span>Борг до виплати</span>
              <strong>{formatCompactMoney(data?.payrollOverview.liability ?? 0)}</strong>
            </div>
            <div>
              <span>Працівників з боргом</span>
              <strong>{data?.payrollOverview.employeesWithDebt ?? 0}</strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Проблеми</p>
              <h2>Алерти та ризики</h2>
            </div>
          </div>
          <div className="schedule-table">
            {(data?.alerts ?? []).map((alert, index) => (
              <Link key={`${alert.kind}-${index}`} href={alert.href} className={`alert-row alert-${alert.severity}`}>
                <strong>{alert.title}</strong>
                <span>{alert.description}</span>
              </Link>
            ))}
            {!data?.alerts?.length ? <p className="hint">Критичних алертів зараз немає.</p> : null}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Тренди</p>
            <h2>Зарплата та години по днях</h2>
          </div>
          <div className="panel-actions">
            <Link href="/admin/analytics" className="button button-secondary button-compact">
              Глибша аналітика
            </Link>
          </div>
        </div>

        <div className="control-charts-grid">
          <div className="chart-card">
            <div className="panel-head">
              <p className="eyebrow">Зарплата</p>
              <h2>Нарахування по днях</h2>
            </div>
            <div className="trend-list">
              {(data?.trends ?? []).map((row) => (
                <div key={row.day} className="trend-row">
                  <span>{row.day}</span>
                  <div className="trend-bar-track">
                  <div className="trend-bar-fill payroll" style={{ width: `${Math.max(6, (row.payrollAmount / trendMaxPayroll) * 100)}%` }} />
                  </div>
                  <strong>{formatCompactMoney(row.payrollAmount)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-card">
            <div className="panel-head">
              <p className="eyebrow">Години</p>
              <h2>Години по днях</h2>
            </div>
            <div className="trend-list">
              {(data?.trends ?? []).map((row) => (
                <div key={row.day} className="trend-row">
                  <span>{row.day}</span>
                  <div className="trend-bar-track">
                    <div className="trend-bar-fill hours" style={{ width: `${Math.max(6, (row.workedMinutes / trendMaxHours) * 100)}%` }} />
                  </div>
                  <strong>{formatHours(row.workedMinutes)}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {quickAction ? (
        <>
          <button type="button" className="popover-scrim" onClick={() => setQuickAction(null)} />
          <div className="panel popover quick-action-modal">
            {quickAction === "manualShift" ? (
              <>
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Quick action</p>
                    <h2>Створити зміну вручну</h2>
                  </div>
                </div>
                <label className="field">
                  <span>Працівник</span>
                  <select
                    value={manualShiftForm.employeeId}
                    onChange={(e) => setManualShiftForm((current) => ({ ...current, employeeId: e.target.value }))}
                  >
                    {(data?.employees ?? []).map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Дія</span>
                  <select
                    value={manualShiftForm.action}
                    onChange={(e) =>
                      setManualShiftForm((current) => ({ ...current, action: e.target.value as "start" | "finish" }))
                    }
                  >
                    <option value="start">Почати зміну</option>
                    <option value="finish">Завершити зміну</option>
                  </select>
                </label>
                <div className="field-row">
                  <button type="button" className="button button-primary full-width" disabled={submitting} onClick={submitManualShift}>
                    Застосувати
                  </button>
                  <button type="button" className="button button-secondary full-width" onClick={() => setQuickAction(null)}>
                    Скасувати
                  </button>
                </div>
              </>
            ) : null}

            {quickAction === "employee" ? (
              <>
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Quick action</p>
                    <h2>Додати працівника</h2>
                  </div>
                </div>
                <label className="field">
                  <span>Ім'я</span>
                  <input value={employeeForm.fullName} onChange={(e) => setEmployeeForm((current) => ({ ...current, fullName: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input value={employeeForm.email} onChange={(e) => setEmployeeForm((current) => ({ ...current, email: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Пароль</span>
                  <input value={employeeForm.password} onChange={(e) => setEmployeeForm((current) => ({ ...current, password: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Ставка</span>
                  <input type="number" step="0.01" value={employeeForm.hourlyRate} onChange={(e) => setEmployeeForm((current) => ({ ...current, hourlyRate: e.target.value }))} />
                </label>
                <div className="field-row">
                  <button type="button" className="button button-primary full-width" disabled={submitting} onClick={submitEmployee}>
                    Створити
                  </button>
                  <button type="button" className="button button-secondary full-width" onClick={() => setQuickAction(null)}>
                    Скасувати
                  </button>
                </div>
              </>
            ) : null}

            {quickAction === "advance" ? (
              <>
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Quick action</p>
                    <h2>Додати аванс</h2>
                  </div>
                </div>
                <label className="field">
                  <span>Працівник</span>
                  <select
                    value={advanceForm.employeeId}
                    onChange={(e) => setAdvanceForm((current) => ({ ...current, employeeId: e.target.value }))}
                  >
                    {(data?.employees ?? []).map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Дата</span>
                  <input type="date" value={advanceForm.paymentDate} onChange={(e) => setAdvanceForm((current) => ({ ...current, paymentDate: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Сума</span>
                  <input type="number" step="0.01" value={advanceForm.amount} onChange={(e) => setAdvanceForm((current) => ({ ...current, amount: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Коментар</span>
                  <input value={advanceForm.comment} onChange={(e) => setAdvanceForm((current) => ({ ...current, comment: e.target.value }))} />
                </label>
                <div className="field-row">
                  <button type="button" className="button button-primary full-width" disabled={submitting} onClick={submitAdvance}>
                    Додати
                  </button>
                  <button type="button" className="button button-secondary full-width" onClick={() => setQuickAction(null)}>
                    Скасувати
                  </button>
                </div>
              </>
            ) : null}

            {quickAction === "runPayroll" ? (
              <>
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Quick action</p>
                    <h2>Запустити payroll run</h2>
                  </div>
                </div>
                <p className="muted-copy">
                  Буде створено payroll run для періоду {range.start} - {range.end} зі snapshot по всіх працівниках.
                </p>
                <div className="field-row">
                  <button type="button" className="button button-primary full-width" disabled={submitting} onClick={submitPayrollRun}>
                    Створити run
                  </button>
                  <button type="button" className="button button-secondary full-width" onClick={() => setQuickAction(null)}>
                    Скасувати
                  </button>
                </div>
              </>
            ) : null}

            {quickAction === "closePayroll" ? (
              <>
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Quick action</p>
                    <h2>Закрити період зарплати</h2>
                  </div>
                </div>
                <p className="muted-copy">
                  Система закриє останній draft payroll run для періоду {range.start} - {range.end}.
                </p>
                <div className="field-row">
                  <button type="button" className="button button-primary full-width" disabled={submitting} onClick={submitClosePayroll}>
                    Закрити період
                  </button>
                  <button type="button" className="button button-secondary full-width" onClick={() => setQuickAction(null)}>
                    Скасувати
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
