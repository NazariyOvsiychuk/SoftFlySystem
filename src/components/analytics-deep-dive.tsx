"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCompactMoney, formatHours, formatMoney } from "@/lib/format";
import { getAccessToken } from "@/lib/supabase";

type PeriodPreset = "7d" | "30d" | "3m" | "year" | "custom";

type AnalyticsPayload = {
  summary: {
    totalAccrual: number;
    totalAdvances: number;
    totalPaid: number;
    liabilityEnd: number;
    avgWorkdayCost: number;
    avgHourlyCost: number;
    totalWorkedMinutes: number;
    avgShiftMinutes: number;
    totalShiftCount: number;
    editedShiftCount: number;
    earlyExitCount: number;
    lateExitCount: number;
    openInvalidCount: number;
    advanceEmployeesCount: number;
    averageAdvanceAmount: number;
    advancesShare: number;
  };
  dailyRows: Array<{
    day: string;
    payrollAmount: number;
    advancesAmount: number;
    paidAmount: number;
    workedMinutes: number;
    shiftCount: number;
    averageShiftMinutes: number;
    activeEmployees: number;
    editedShiftCount: number;
  }>;
  liabilitySeries: Array<{ day: string; liabilityAmount: number }>;
  topByHours: Array<{ employeeId: string; fullName: string; totalMinutes: number }>;
  topBySalary: Array<{ employeeId: string; fullName: string; totalAmount: number }>;
  topByShifts: Array<{ employeeId: string; fullName: string; totalShifts: number }>;
  leastActive: Array<{ employeeId: string; fullName: string; totalMinutes: number }>;
  insights: string[];
  anomalies: Array<{ kind: string; title: string; description: string }>;
};

function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getPresetRange(preset: PeriodPreset) {
  const now = new Date();
  if (preset === "7d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { start: toDateInputValue(start), end: toDateInputValue(now) };
  }
  if (preset === "30d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 29);
    return { start: toDateInputValue(start), end: toDateInputValue(now) };
  }
  if (preset === "3m") {
    const start = new Date(now);
    start.setMonth(now.getMonth() - 3);
    return { start: toDateInputValue(start), end: toDateInputValue(now) };
  }
  if (preset === "year") {
    const start = new Date(now);
    start.setFullYear(now.getFullYear() - 1);
    return { start: toDateInputValue(start), end: toDateInputValue(now) };
  }
  return { start: toDateInputValue(now), end: toDateInputValue(now) };
}

async function callAdmin<T>(path: string, body: unknown) {
  const token = await getAccessToken();
  if (!token) return { ok: false as const, error: "Немає сесії адміністратора." };
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) return { ok: false as const, error: payload.error ?? "Request failed." };
  return { ok: true as const, data: payload };
}

function maxOf(values: number[]) {
  return values.length ? Math.max(...values, 1) : 1;
}

export function AnalyticsDeepDive() {
  const initialRange = getPresetRange("30d");
  const [preset, setPreset] = useState<PeriodPreset>("30d");
  const [range, setRange] = useState(initialRange);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsPayload | null>(null);

  useEffect(() => {
    if (preset === "custom") return;
    setRange(getPresetRange(preset));
  }, [preset]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await callAdmin<AnalyticsPayload>("/api/admin/analytics/deep", {
        start: range.start,
        end: range.end,
      });
      if (!result.ok) {
        setMessage(result.error ?? "Не вдалося завантажити аналітику.");
        setData(null);
      } else {
        setMessage(null);
        setData(result.data);
      }
      setLoading(false);
    }
    void load();
  }, [range.end, range.start]);

  const dailyMaxPayroll = useMemo(() => maxOf((data?.dailyRows ?? []).map((row) => row.payrollAmount)), [data]);
  const dailyMaxHours = useMemo(() => maxOf((data?.dailyRows ?? []).map((row) => row.workedMinutes)), [data]);
  const liabilityMax = useMemo(() => maxOf((data?.liabilitySeries ?? []).map((row) => row.liabilityAmount)), [data]);

  return (
    <section className="payroll-shell">
      <div className="control-center-hero">
        <div>
          <p className="eyebrow">Аналітика</p>
          <h1>Історичні тренди та витрати на персонал</h1>
          <p className="muted-copy">
            Не операційний екран, а інструмент для рішень: витрати, навантаження, аванси, ризики та аномалії в часі.
          </p>
        </div>
      </div>

      <section className="panel control-toolbar">
        <div className="segmented-control">
          {[
            ["7d", "7 днів"],
            ["30d", "30 днів"],
            ["3m", "3 місяці"],
            ["year", "Рік"],
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

      <section className="analytics-summary-grid">
        <article className="stat-card">
          <span>Витрати на зарплати</span>
          <strong>{formatCompactMoney(data?.summary.totalAccrual ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Витрати на аванси</span>
          <strong>{formatCompactMoney(data?.summary.totalAdvances ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Виплачено</span>
          <strong>{formatCompactMoney(data?.summary.totalPaid ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Борг компанії перед працівниками</span>
          <strong>{formatCompactMoney(data?.summary.liabilityEnd ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Середня вартість зміни</span>
          <strong>{formatMoney(data?.summary.avgWorkdayCost ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Середня погодинна вартість</span>
          <strong>{formatMoney(data?.summary.avgHourlyCost ?? 0)}</strong>
        </article>
      </section>

      <section className="control-charts-grid">
        <article className="panel chart-card">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Фінанси</p>
              <h2>Зарплата по днях</h2>
            </div>
          </div>
          <div className="trend-list">
            {(data?.dailyRows ?? []).map((row) => (
              <div key={row.day} className="trend-row">
                <span>{row.day}</span>
                <div className="trend-bar-track">
                <div className="trend-bar-fill payroll" style={{ width: `${Math.max(6, (row.payrollAmount / dailyMaxPayroll) * 100)}%` }} />
                </div>
                <strong>{formatCompactMoney(row.payrollAmount)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel chart-card">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Навантаження</p>
              <h2>Години по днях</h2>
            </div>
          </div>
          <div className="trend-list">
            {(data?.dailyRows ?? []).map((row) => (
              <div key={row.day} className="trend-row">
                <span>{row.day}</span>
                <div className="trend-bar-track">
                  <div className="trend-bar-fill hours" style={{ width: `${Math.max(6, (row.workedMinutes / dailyMaxHours) * 100)}%` }} />
                </div>
                <strong>{formatHours(row.workedMinutes)}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="control-charts-grid">
        <article className="panel chart-card">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Борг</p>
              <h2>Борг компанії в часі</h2>
            </div>
          </div>
          <div className="trend-list">
            {(data?.liabilitySeries ?? []).map((row) => (
              <div key={row.day} className="trend-row">
                <span>{row.day}</span>
                <div className="trend-bar-track">
                <div className="trend-bar-fill liability" style={{ width: `${Math.max(6, (row.liabilityAmount / liabilityMax) * 100)}%` }} />
                </div>
                <strong>{formatCompactMoney(row.liabilityAmount)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Зміни</p>
              <h2>Статистика по змінах</h2>
            </div>
          </div>
          <div className="control-mini-stats">
            <div>
              <span>Сер. тривалість</span>
              <strong>{formatHours(data?.summary.avgShiftMinutes ?? 0)}</strong>
            </div>
            <div>
              <span>Змін за період</span>
              <strong>{data?.summary.totalShiftCount ?? 0}</strong>
            </div>
            <div>
              <span>Ранні виходи</span>
              <strong>{data?.summary.earlyExitCount ?? 0}</strong>
            </div>
            <div>
              <span>Пізні виходи</span>
              <strong>{data?.summary.lateExitCount ?? 0}</strong>
            </div>
            <div>
              <span>Відкриті / некоректні</span>
              <strong>{data?.summary.openInvalidCount ?? 0}</strong>
            </div>
            <div>
              <span>Редагувань змін</span>
              <strong>{data?.summary.editedShiftCount ?? 0}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel large">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Топи</p>
              <h2>Продуктивність працівників</h2>
            </div>
          </div>
          <div className="control-charts-grid">
            <div className="schedule-table">
              <p className="eyebrow">Найбільше годин</p>
              {(data?.topByHours ?? []).map((row) => (
                <div key={row.employeeId} className="table-row">
                  <strong>{row.fullName}</strong>
                  <span>{formatHours(row.totalMinutes)}</span>
                </div>
              ))}
            </div>

            <div className="schedule-table">
              <p className="eyebrow">Найбільша зарплата</p>
              {(data?.topBySalary ?? []).map((row) => (
                <div key={row.employeeId} className="table-row">
                  <strong>{row.fullName}</strong>
                  <span>{formatMoney(row.totalAmount)}</span>
                </div>
              ))}
            </div>

            <div className="schedule-table">
              <p className="eyebrow">Найбільше змін</p>
              {(data?.topByShifts ?? []).map((row) => (
                <div key={row.employeeId} className="table-row">
                  <strong>{row.fullName}</strong>
                  <span>{row.totalShifts}</span>
                </div>
              ))}
            </div>

            <div className="schedule-table">
              <p className="eyebrow">Найменша активність</p>
              {(data?.leastActive ?? []).map((row) => (
                <div key={row.employeeId} className="table-row">
                  <strong>{row.fullName}</strong>
                  <span>{formatHours(row.totalMinutes)}</span>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Інсайти</p>
              <h2>Що змінюється</h2>
            </div>
          </div>
          <div className="schedule-table">
            {(data?.insights ?? []).map((insight, index) => (
              <div key={index} className="alert-row alert-low">
                <strong>Інсайт</strong>
                <span>{insight}</span>
              </div>
            ))}
            {!data?.insights?.length ? <p className="hint">Помітних трендів за період не виявлено.</p> : null}
          </div>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Аванси</p>
              <h2>Аванси та виплати</h2>
            </div>
          </div>
          <div className="control-mini-stats">
            <div>
              <span>Сума авансів</span>
              <strong>{formatCompactMoney(data?.summary.totalAdvances ?? 0)}</strong>
            </div>
            <div>
              <span>Частка авансів</span>
              <strong>{data?.summary.advancesShare ?? 0}%</strong>
            </div>
            <div>
              <span>Працівників з авансом</span>
              <strong>{data?.summary.advanceEmployeesCount ?? 0}</strong>
            </div>
            <div>
              <span>Середній аванс</span>
              <strong>{formatMoney(data?.summary.averageAdvanceAmount ?? 0)}</strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Аномалії</p>
              <h2>Проблемні патерни</h2>
            </div>
          </div>
          <div className="schedule-table">
            {(data?.anomalies ?? []).map((row, index) => (
              <div key={`${row.kind}-${index}`} className="alert-row alert-medium">
                <strong>{row.title}</strong>
                <span>{row.description}</span>
              </div>
            ))}
            {!data?.anomalies?.length ? <p className="hint">Явних аномалій у вибраному періоді немає.</p> : null}
          </div>
        </article>
      </section>

      {loading ? <section className="panel">Завантажуємо аналітику...</section> : null}
    </section>
  );
}
