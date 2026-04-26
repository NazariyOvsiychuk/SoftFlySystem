"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatHours, formatMoney } from "@/lib/format";
import { getAccessToken } from "@/lib/supabase";

type PeriodPreset = "today" | "week" | "month" | "previousMonth" | "custom";
type CostCategory = "rent" | "utilities" | "other";

type BatchRow = {
  id?: string;
  batchStart: string;
  batchEnd: string;
  batchLabel: string;
  quantity: number;
  unitPrice: number;
  revenueAmount?: number;
  note: string;
};

type CostRow = {
  id?: string;
  periodStart: string;
  periodEnd: string;
  category: CostCategory;
  amount: number;
  allocatedAmount?: number;
  note: string;
};

type ProfitabilityPayload = {
  periodStart: string;
  periodEnd: string;
  summary: {
    totalRevenue: number;
    totalPayroll: number;
    totalOperatingCosts: number;
    rentCosts: number;
    utilitiesCosts: number;
    otherCosts: number;
    totalTax: number;
    withdrawalFee: number;
    automaticRentCosts: number;
    batchCoveredDays: number;
    grossMargin: number;
    marginRate: number;
    batchCount: number;
  };
  settings: {
    monthlyRentAmount: number;
    taxRate: number;
    withdrawalFeeRate: number;
  };
  payrollRows: Array<{
    employeeId: string;
    fullName: string;
    workedMinutes: number;
    totalDue: number;
  }>;
  batches: Array<{
    id: string;
    batchStart: string;
    batchEnd: string;
    batchLabel: string;
    quantity: number;
    unitPrice: number;
    revenueAmount: number;
    note: string | null;
  }>;
  costs: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    category: CostCategory;
    amount: number;
    allocatedAmount: number;
    note: string | null;
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

async function callAdminJson<T>(
  path: string,
  options?: { method?: "GET" | "PUT"; body?: unknown }
) {
  const token = await getAccessToken();
  if (!token) return { ok: false as const, error: "Немає сесії адміністратора." };

  const response = await fetch(path, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.method && options.method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    ...(options?.method && options.method !== "GET" ? { body: JSON.stringify(options.body ?? {}) } : {}),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) return { ok: false as const, error: payload.error ?? "Request failed." };
  return { ok: true as const, data: payload };
}

function categoryLabel(category: CostCategory) {
  if (category === "rent") return "Оренда";
  if (category === "utilities") return "Комунальні";
  return "Інше";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function enumerateDates(start: string, end: string) {
  if (!start || !end) return [] as string[];
  const current = new Date(`${start}T00:00:00`);
  const limit = new Date(`${end}T00:00:00`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(limit.getTime()) || current.getTime() > limit.getTime()) {
    return [] as string[];
  }

  const dates: string[] = [];
  while (current.getTime() <= limit.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function daysInMonth(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 30;
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function ProfitabilityAdminPage() {
  const initialRange = getPresetRange("month");
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [range, setRange] = useState(initialRange);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProfitabilityPayload | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [payrollSort, setPayrollSort] = useState<"amountDesc" | "amountAsc" | "hoursDesc" | "nameAsc">("amountDesc");
  const [isDirty, setIsDirty] = useState(false);
  const initialLoadRef = useRef(true);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (preset === "custom") return;
    setRange(getPresetRange(preset));
  }, [preset]);

  async function load() {
    setLoading(true);
    const result = await callAdminJson<ProfitabilityPayload>(
      `/api/admin/profitability?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`
    );

    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося завантажити маржинальність.");
      setSnapshot(null);
      setBatches([]);
      setCosts([]);
    } else {
      setMessage(null);
      setSnapshot(result.data);
      setBatches(
        (result.data.batches ?? []).map((row) => ({
          id: row.id,
          batchStart: row.batchStart,
          batchEnd: row.batchEnd,
          batchLabel: row.batchLabel,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          revenueAmount: row.revenueAmount,
          note: row.note ?? "",
        }))
      );
      setCosts(
        (result.data.costs ?? []).map((row) => ({
          id: row.id,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          category: row.category,
          amount: row.amount,
          allocatedAmount: row.allocatedAmount,
          note: row.note ?? "",
        }))
      );
      setIsDirty(false);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [range.end, range.start]);

  const draftRevenue = useMemo(
    () =>
      roundMoney(
        batches.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unitPrice || 0), 0)
      ),
    [batches]
  );

  const draftUtilitiesAndOther = useMemo(
    () =>
      roundMoney(
        costs
          .filter((row) => row.category === "utilities" || row.category === "other")
          .reduce((sum, row) => sum + Number(row.amount || 0), 0)
      ),
    [costs]
  );
  const draftManualRent = useMemo(
    () =>
      roundMoney(
        costs.filter((row) => row.category === "rent").reduce((sum, row) => sum + Number(row.amount || 0), 0)
      ),
    [costs]
  );
  const draftBatchCoveredDays = useMemo(() => {
    const coveredDays = new Set<string>();
    for (const row of batches) {
      for (const date of enumerateDates(row.batchStart, row.batchEnd)) {
        coveredDays.add(date);
      }
    }
    return coveredDays;
  }, [batches]);
  const rentPerMonth = snapshot?.settings.monthlyRentAmount ?? 65000;
  const taxRate = snapshot?.settings.taxRate ?? 0.23;
  const withdrawalFeeRate = snapshot?.settings.withdrawalFeeRate ?? 0.02;
  const draftAutomaticRent = useMemo(
    () =>
      roundMoney(
        Array.from(draftBatchCoveredDays).reduce((sum, date) => sum + rentPerMonth / daysInMonth(date), 0)
      ),
    [draftBatchCoveredDays, rentPerMonth]
  );
  const draftTax = roundMoney(draftRevenue * taxRate);
  const draftWithdrawalFee = roundMoney(draftRevenue * withdrawalFeeRate);
  const draftRent = roundMoney(draftAutomaticRent + draftManualRent);

  const payrollTotal = snapshot?.summary.totalPayroll ?? 0;
  const draftMargin = roundMoney(
    draftRevenue - payrollTotal - draftTax - draftRent - draftUtilitiesAndOther - draftWithdrawalFee
  );
  const draftMarginRate = draftRevenue > 0 ? Math.round((draftMargin / draftRevenue) * 1000) / 10 : 0;

  const sortedPayrollRows = useMemo(() => {
    const rows = [...(snapshot?.payrollRows ?? [])];
    rows.sort((a, b) => {
      if (payrollSort === "amountAsc") return a.totalDue - b.totalDue;
      if (payrollSort === "hoursDesc") return b.workedMinutes - a.workedMinutes;
      if (payrollSort === "nameAsc") return a.fullName.localeCompare(b.fullName, "uk");
      return b.totalDue - a.totalDue;
    });
    return rows;
  }, [payrollSort, snapshot?.payrollRows]);

  function updateBatch(index: number, patch: Partial<BatchRow>) {
    setIsDirty(true);
    setBatches((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function updateCost(index: number, patch: Partial<CostRow>) {
    setIsDirty(true);
    setCosts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addBatch() {
    setIsDirty(true);
    setBatches((current) => [
      {
        batchStart: range.start,
        batchEnd: range.end,
        batchLabel: `Партія ${current.length + 1}`,
        quantity: 0,
        unitPrice: 0,
        note: "",
      },
      ...current,
    ]);
  }

  function addCost() {
    setIsDirty(true);
    setCosts((current) => [
      {
        periodStart: range.start,
        periodEnd: range.end,
        category: "rent",
        amount: 0,
        note: "",
      },
      ...current,
    ]);
  }

  async function saveAll() {
    setSaving(true);
    const result = await callAdminJson<{ message: string; snapshot?: ProfitabilityPayload }>("/api/admin/profitability", {
      method: "PUT",
      body: {
        periodStart: range.start,
        periodEnd: range.end,
        batches: batches.map((row) => ({
          id: row.id,
          batchStart: row.batchStart,
          batchEnd: row.batchEnd,
          batchLabel: row.batchLabel,
          quantity: Number(row.quantity),
          unitPrice: Number(row.unitPrice),
          note: row.note,
        })),
        costs: costs.map((row) => ({
          id: row.id,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          category: row.category,
          amount: Number(row.amount),
          note: row.note,
        })),
      },
    });
    setSaving(false);

    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося зберегти дані.");
      return;
    }

    setMessage(result.data.message ?? "Збережено.");
    if (result.data.snapshot) {
      syncingRef.current = true;
      setSnapshot(result.data.snapshot);
      setBatches(
        (result.data.snapshot.batches ?? []).map((row) => ({
          id: row.id,
          batchStart: row.batchStart,
          batchEnd: row.batchEnd,
          batchLabel: row.batchLabel,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          revenueAmount: row.revenueAmount,
          note: row.note ?? "",
        }))
      );
      setCosts(
        (result.data.snapshot.costs ?? []).map((row) => ({
          id: row.id,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          category: row.category,
          amount: row.amount,
          allocatedAmount: row.allocatedAmount,
          note: row.note ?? "",
        }))
      );
      setTimeout(() => {
        syncingRef.current = false;
      }, 0);
    }
    setIsDirty(false);
  }

  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    if (syncingRef.current) return;
    if (!isDirty) return;
    if (loading) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void saveAll();
    }, 1600);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [batches, costs, isDirty, loading]);

  return (
    <section className="payroll-shell profitability-shell">
      <div className="payroll-hero">
        <div>
          <p className="eyebrow">Маржинальність</p>
          <h1>Партії, витрати і проста маржа</h1>
          <p className="muted-copy">Усе зберігається автоматично.</p>
        </div>
      </div>

      <section className="panel profitability-toolbar">
        <label className="field">
          <span>Період</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)}>
            <option value="today">Сьогодні</option>
            <option value="week">Цей тиждень</option>
            <option value="month">Цей місяць</option>
            <option value="previousMonth">Попередній місяць</option>
            <option value="custom">Довільний період</option>
          </select>
        </label>
        <label className="field">
          <span>Початок</span>
          <input
            type="date"
            value={range.start}
            onChange={(e) => {
              setPreset("custom");
              setRange((current) => ({ ...current, start: e.target.value }));
            }}
          />
        </label>
        <label className="field">
          <span>Кінець</span>
          <input
            type="date"
            value={range.end}
            onChange={(e) => {
              setPreset("custom");
              setRange((current) => ({ ...current, end: e.target.value }));
            }}
          />
        </label>
      </section>

      {message ? <section className="panel notice-panel">{message}</section> : null}
      {loading ? <section className="panel">Завантажуємо маржинальність...</section> : null}

      {!loading && snapshot ? (
        <>
          <section className="payroll-metrics-grid profitability-metrics-grid">
            <article className="panel stat-card">
              <span>Виручка по партіях</span>
              <strong>{formatMoney(snapshot.summary.totalRevenue)}</strong>
            </article>
            <article className="panel stat-card">
              <span>Зарплатні витрати</span>
              <strong>{formatMoney(snapshot.summary.totalPayroll)}</strong>
            </article>
            <article className="panel stat-card">
              <span>Податок {(taxRate * 100).toFixed(0)}%</span>
              <strong>{formatMoney(snapshot.summary.totalTax)}</strong>
            </article>
            <article className="panel stat-card">
              <span>Оренда + комунальні</span>
              <strong>{formatMoney(snapshot.summary.rentCosts + snapshot.summary.utilitiesCosts)}</strong>
            </article>
            <article className="panel stat-card">
              <span>Комісія за зняття {(withdrawalFeeRate * 100).toFixed(0)}%</span>
              <strong>{formatMoney(snapshot.summary.withdrawalFee)}</strong>
            </article>
            <article className="panel stat-card">
              <span>Маржа / маржинальність</span>
              <strong>
                {formatMoney(snapshot.summary.grossMargin)} · {snapshot.summary.marginRate.toFixed(1)}%
              </strong>
            </article>
          </section>

          <section className="profitability-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Статистика витрат</p>
                  <h2>Як формується маржа за період</h2>
                </div>
              </div>
              <div className="profitability-formula">
                <div className="formula-line">
                  <span>Прихід: дрони × ціна за 1</span>
                  <strong>{formatMoney(draftRevenue)}</strong>
                </div>
                <div className="formula-line negative">
                  <span>Мінус працівники в межах днів партій</span>
                  <strong>- {formatMoney(payrollTotal)}</strong>
                </div>
                <div className="formula-line negative">
                  <span>Мінус податок {(taxRate * 100).toFixed(0)}%</span>
                  <strong>- {formatMoney(draftTax)}</strong>
                </div>
                <div className="formula-line negative">
                  <span>Мінус оренда за дні партій</span>
                  <strong>- {formatMoney(draftRent)}</strong>
                </div>
                <div className="formula-line negative">
                  <span>Мінус комунальні та інші</span>
                  <strong>- {formatMoney(draftUtilitiesAndOther)}</strong>
                </div>
                <div className="formula-line negative">
                  <span>Мінус комісія за зняття {(withdrawalFeeRate * 100).toFixed(0)}%</span>
                  <strong>- {formatMoney(draftWithdrawalFee)}</strong>
                </div>
                <div className="formula-total">
                  <span>Чернетка маржі</span>
                  <strong>{formatMoney(draftMargin)}</strong>
                  <em>{draftMarginRate.toFixed(1)}% від виручки · днів партій: {draftBatchCoveredDays.size}</em>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Витрати на працівників</p>
                  <h2>Скільки коштували працівники за цей період</h2>
                  <p className="muted-copy">
                    Тут показана сума, яку працівники заробили саме в дні активних партій. Зміни поза партіями сюди не потрапляють.
                  </p>
                </div>
                <div className="panel-actions">
                  <label className="field profitability-sort-field">
                    <span>Сортування</span>
                    <select value={payrollSort} onChange={(e) => setPayrollSort(e.target.value as typeof payrollSort)}>
                      <option value="amountDesc">Найдорожчі зверху</option>
                      <option value="amountAsc">Найдешевші зверху</option>
                      <option value="hoursDesc">Найбільше годин</option>
                      <option value="nameAsc">За ім'ям</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="compact-table">
                <div className="compact-table-head compact-table-head-employee-cost">
                  <span>Працівник</span>
                  <span>Години</span>
                  <span>Витрата</span>
                </div>
                {sortedPayrollRows.map((row) => (
                  <div key={row.employeeId} className="compact-table-row compact-table-head-employee-cost">
                    <strong>{row.fullName}</strong>
                    <span>{formatHours(row.workedMinutes)}</span>
                    <span>{formatMoney(row.totalDue)}</span>
                  </div>
                ))}
                {!sortedPayrollRows.length ? <p className="muted-copy">За цей період зарплатних нарахувань ще немає.</p> : null}
              </div>
            </article>
          </section>

          <section className="profitability-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Партії</p>
                  <h2>Що виробили в цей період</h2>
                </div>
                <div className="panel-actions">
                  <button type="button" className="button button-secondary button-compact" onClick={addBatch}>
                    Додати партію
                  </button>
                </div>
              </div>

              <div className="editable-list">
                {batches.map((row, index) => (
                  <article key={row.id ?? `batch-${index}`} className="editor-card">
                    <div className="editor-card-topline">
                      <strong>{row.batchLabel || `Партія ${index + 1}`}</strong>
                      <button
                        type="button"
                        className="button button-secondary button-compact"
                        onClick={() => {
                          setIsDirty(true);
                          setBatches((current) => current.filter((_, rowIndex) => rowIndex !== index));
                        }}
                      >
                        Видалити
                      </button>
                    </div>
                    <div className="field-row profitability-field-row">
                      <label className="field">
                        <span>Початок партії</span>
                        <input type="date" value={row.batchStart} onChange={(e) => updateBatch(index, { batchStart: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Кінець партії</span>
                        <input type="date" value={row.batchEnd} onChange={(e) => updateBatch(index, { batchEnd: e.target.value })} />
                      </label>
                    </div>

                    <div className="field-row profitability-field-row">
                      <label className="field profitability-field-span-2">
                        <span>Назва партії</span>
                        <input value={row.batchLabel} onChange={(e) => updateBatch(index, { batchLabel: e.target.value })} />
                      </label>
                    </div>

                    <div className="field-row profitability-field-row">
                      <label className="field">
                        <span>Кількість дронів</span>
                        <input type="number" min="0" step="0.01" value={row.quantity} onChange={(e) => updateBatch(index, { quantity: Number(e.target.value) })} />
                      </label>
                      <label className="field">
                        <span>Сума за 1 дрон</span>
                        <input type="number" min="0" step="0.01" value={row.unitPrice} onChange={(e) => updateBatch(index, { unitPrice: Number(e.target.value) })} />
                      </label>
                    </div>

                    <div className="field-row profitability-field-row profitability-field-row-bottom">
                      <label className="field">
                        <span>Нотатка</span>
                        <input value={row.note} onChange={(e) => updateBatch(index, { note: e.target.value })} />
                      </label>
                      <div className="profitability-inline-actions">
                        <div className="profitability-inline-total">
                          <span>Прихід по партії</span>
                          <strong>{formatMoney(Number(row.quantity || 0) * Number(row.unitPrice || 0))}</strong>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {!batches.length ? <p className="muted-copy">Ще немає жодної партії за обраний період.</p> : null}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Витрати</p>
                  <h2>Оренда, комунальні та інші витрати</h2>
                </div>
                <div className="panel-actions">
                  <button type="button" className="button button-secondary button-compact" onClick={addCost}>
                    Додати витрату
                  </button>
                </div>
              </div>

              <div className="editable-list">
                {costs.map((row, index) => (
                  <article key={row.id ?? `cost-${index}`} className="editor-card">
                    <div className="editor-card-topline">
                      <strong>{categoryLabel(row.category)}</strong>
                      <button
                        type="button"
                        className="button button-secondary button-compact"
                        onClick={() => {
                          setIsDirty(true);
                          setCosts((current) => current.filter((_, rowIndex) => rowIndex !== index));
                        }}
                      >
                        Видалити
                      </button>
                    </div>
                    <div className="field-row profitability-field-row">
                      <label className="field">
                        <span>Початок періоду</span>
                        <input type="date" value={row.periodStart} onChange={(e) => updateCost(index, { periodStart: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Кінець періоду</span>
                        <input type="date" value={row.periodEnd} onChange={(e) => updateCost(index, { periodEnd: e.target.value })} />
                      </label>
                    </div>

                    <div className="field-row profitability-field-row">
                      <label className="field">
                        <span>Категорія</span>
                        <select value={row.category} onChange={(e) => updateCost(index, { category: e.target.value as CostCategory })}>
                          <option value="rent">Ручна оренда / доплата</option>
                          <option value="utilities">Комунальні</option>
                          <option value="other">Інше</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Сума за весь період</span>
                        <input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => updateCost(index, { amount: Number(e.target.value) })} />
                      </label>
                    </div>

                    <div className="field-row profitability-field-row profitability-field-row-bottom">
                      <label className="field">
                        <span>Нотатка</span>
                        <input value={row.note} onChange={(e) => updateCost(index, { note: e.target.value })} />
                      </label>
                      <div className="profitability-inline-actions">
                        <div className="profitability-inline-total">
                          <span>{categoryLabel(row.category)}</span>
                          <strong>{formatMoney(Number(row.amount || 0))}</strong>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {!costs.length ? <p className="muted-copy">Ще немає жодної витрати для цього періоду.</p> : null}
              </div>
            </article>
          </section>

          <section className="profitability-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Поточні партії</p>
                  <h2>Уже збережені записи</h2>
                </div>
              </div>
              <div className="compact-table">
                <div className="compact-table-head compact-table-head-batches">
                  <span>Період</span>
                  <span>Партія</span>
                  <span>Дронів</span>
                  <span>Ціна за 1</span>
                  <span>Прихід</span>
                </div>
                {snapshot.batches.map((row) => (
                  <div key={row.id} className="compact-table-row compact-table-head-batches">
                    <span>
                      {formatDate(row.batchStart)} - {formatDate(row.batchEnd)}
                    </span>
                    <strong>{row.batchLabel}</strong>
                    <span>{row.quantity}</span>
                    <span>{formatMoney(row.unitPrice)}</span>
                    <span>{formatMoney(row.revenueAmount)}</span>
                  </div>
                ))}
                {!snapshot.batches.length ? <p className="muted-copy">Записів партій поки немає.</p> : null}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Розклад витрат</p>
                  <h2>Що потрапило в цей період</h2>
                </div>
              </div>
              <div className="compact-table">
                <div className="compact-table-head compact-table-head-costs">
                  <span>Категорія</span>
                  <span>Період</span>
                  <span>Загальна сума</span>
                  <span>Увійшло в період</span>
                </div>
                {snapshot.costs.map((row) => (
                  <div key={row.id} className="compact-table-row compact-table-head-costs">
                    <strong>{categoryLabel(row.category)}</strong>
                    <span>
                      {formatDate(row.periodStart)} - {formatDate(row.periodEnd)}
                    </span>
                    <span>{formatMoney(row.amount)}</span>
                    <span>{formatMoney(row.allocatedAmount)}</span>
                  </div>
                ))}
                {!snapshot.costs.length ? <p className="muted-copy">Записів витрат поки немає.</p> : null}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </section>
  );
}
