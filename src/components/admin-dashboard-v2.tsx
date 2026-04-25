"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate, formatDateTime, formatHours, formatMoney } from "@/lib/format";
import { getAccessToken, supabase } from "@/lib/supabase";

export type AdminSection =
  | "dashboard"
  | "employees"
  | "schedule"
  | "time"
  | "payroll"
  | "reports"
  | "settings";

type EmployeeRow = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  employee_settings: Array<{
    hourly_rate: number;
    pin_code: string | null;
    fingerprint_id: number | null;
    terminal_access_enabled: boolean;
  }> | null;
};

type ScheduleRow = {
  id: string;
  employee_id: string;
  work_date: string;
  day_type: string;
  expected_start?: string | null;
  expected_end?: string | null;
  profiles: unknown;
};

type ShiftRow = {
  id: string;
  employee_id?: string;
  shift_date: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  status: string;
  profiles: unknown;
};

type DeviceTerminalRow = {
  id: string;
  device_name: string;
  device_code: string;
  is_active: boolean;
  location_label: string | null;
};

type OvertimeRule = {
  overtime_threshold_minutes_per_day: number;
  overtime_multiplier: number;
};

type PayrollSummaryRow = {
  employeeId: string;
  fullName: string;
  hourlyRate: number;
  workedMinutes: number;
  coveredMinutes: number;
  uncoveredMinutes: number;
  workedAmount: number;
  coveredAmount: number;
  uncoveredAmount: number;
};

type AnalyticsOverview = {
  currentOnShift: number;
  topHours: Array<{ employee_id: string; full_name: string; total_minutes: number }>;
  laborCostByDay: Array<{
    work_date: string;
    total_minutes: number;
    base_amount: number;
    overtime_amount: number;
    total_amount: number;
  }>;
  disciplineTop: Array<{
    employeeId: string;
    fullName: string;
    missedRequiredDays: number;
    lateCheckins: number;
    earlyCheckouts: number;
    openWithoutCheckout: number;
    disciplineScore: number;
  }>;
  disciplineBottom: Array<{
    employeeId: string;
    fullName: string;
    missedRequiredDays: number;
    lateCheckins: number;
    earlyCheckouts: number;
    openWithoutCheckout: number;
    disciplineScore: number;
  }>;
};

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function employeeSettingsValue(
  value:
    | {
        hourly_rate: number;
        pin_code: string | null;
        fingerprint_id: number | null;
        terminal_access_enabled: boolean;
      }
    | Array<{
        hourly_rate: number;
        pin_code: string | null;
        fingerprint_id: number | null;
        terminal_access_enabled: boolean;
      }>
    | null
    | undefined
) {
  return relationFirst(value);
}

function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function toLocalDateTimeInputValue(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function profileName(rel: unknown): string | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return (rel as any[])[0]?.full_name ?? null;
  if (typeof rel === "object") return (rel as any).full_name ?? null;
  return null;
}

function countDayTypes(entries: ScheduleRow[]) {
  let required = 0;
  let preferred = 0;
  let off = 0;
  for (const e of entries) {
    if (e.day_type === "required") required += 1;
    else if (e.day_type === "preferred") preferred += 1;
    else off += 1;
  }
  return { required, preferred, off, total: entries.length };
}

function toTimeInput(value: string | null | undefined, fallback: string) {
  const v = (value ?? "").toString();
  if (!v) return fallback;
  // Supabase может вернуть time как "09:00:00"
  return v.length >= 5 ? v.slice(0, 5) : fallback;
}

async function callAdminApi(path: string, payload: unknown) {
  const token = await getAccessToken();
  if (!token) {
    return { ok: false, error: "Немає сесії адміністратора." };
  }

  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return { ok: response.ok, error: json.error, message: json.message };
}

async function callAdminApiJson<T>(path: string, payload: unknown) {
  const token = await getAccessToken();
  if (!token) {
    return { ok: false as const, error: "Немає сесії адміністратора." };
  }

  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    return { ok: false as const, error: (json as any).error ?? "Request failed." };
  }
  return { ok: true as const, data: json };
}

export function AdminDashboardV2({ section }: { section: AdminSection }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [deviceTerminals, setDeviceTerminals] = useState<DeviceTerminalRow[]>([]);

  const [analyticsRange, setAnalyticsRange] = useState({
    start: toDateInputValue(monthStart),
    end: toDateInputValue(now),
  });
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);

  const [overtimeRule, setOvertimeRule] = useState<OvertimeRule>({
    overtime_threshold_minutes_per_day: 480,
    overtime_multiplier: 1.25,
  });

  const [createEmployee, setCreateEmployee] = useState({
    fullName: "",
    email: "",
    password: "",
    hourlyRate: "0",
  });
  const [employeeQuery, setEmployeeQuery] = useState("");

  const [scheduleForm, setScheduleForm] = useState({
    applyToAll: true,
    employeeId: "",
    workDate: "",
    dayType: "required",
    expectedStart: "09:00",
    expectedEnd: "18:00",
  });

  const [shiftControl, setShiftControl] = useState({
    employeeId: "",
    action: "start" as "start" | "finish",
  });

  const [payrollForm, setPayrollForm] = useState({
    employeeId: "",
    periodStart: "",
    periodEnd: "",
    bonuses: "0",
    deductions: "0",
    notes: "",
  });

  const [payrollRange, setPayrollRange] = useState(() => ({
    start: toDateInputValue(monthStart),
    end: toDateInputValue(now),
  }));
  const [payrollSummary, setPayrollSummary] = useState<PayrollSummaryRow[]>([]);
  const [payrollSummaryMeta, setPayrollSummaryMeta] = useState<{
    thresholdMinutes: number;
    overtimeMultiplier: number;
  } | null>(null);
  const [payrollSummaryLoaded, setPayrollSummaryLoaded] = useState(false);

  const [terminalForm, setTerminalForm] = useState({
    deviceName: "",
    deviceCode: "",
    secretKey: "",
    locationLabel: "",
  });

  const employeesOnShift = useMemo(() => shifts.filter((s) => s.status === "open").length, [shifts]);
  const today = toDateInputValue(new Date());
  const todaysMinutes = useMemo(
    () =>
      shifts
        .filter((s) => s.shift_date === today && s.status === "closed")
        .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0),
    [shifts, today]
  );

  const monthStartDate = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, []);

  const expectedPayoutThisMonth = useMemo(() => {
    const closedCost =
      overview?.laborCostByDay?.reduce((sum, row) => sum + Number((row as any).total_amount ?? 0), 0) ?? 0;

    const now = new Date();
    const monthStart = monthStartDate.getTime();
    const rateByEmployee = new Map<string, number>();
    for (const emp of employees) {
      rateByEmployee.set(emp.id, Number(employeeSettingsValue(emp.employee_settings)?.hourly_rate ?? 0));
    }

    let openCost = 0;
    for (const shift of shifts) {
      if (shift.status !== "open") continue;
      if (!shift.employee_id) continue;
      const started = new Date(shift.started_at);
      if (Number.isNaN(started.getTime())) continue;
      if (started.getTime() < monthStart) continue;
      const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 60000));
      const rate = rateByEmployee.get(shift.employee_id) ?? 0;
      openCost += (elapsedMinutes / 60) * rate;
    }

    return closedCost + openCost;
  }, [employees, monthStartDate, overview, shifts]);

  async function loadCore() {
    setLoading(true);
    setMessage(null);

    try {
      const rangeStart = new Date();
      rangeStart.setDate(rangeStart.getDate() - 30);
      const rangeEnd = new Date();
      rangeEnd.setDate(rangeEnd.getDate() + 30);

      const [employeesResult, scheduleResult, shiftsResult, terminalsResult] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, full_name, email, is_active, employee_settings(hourly_rate,pin_code,fingerprint_id,terminal_access_enabled)"
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("schedule_days")
          .select(
            "id, employee_id, work_date, day_type, expected_start, expected_end, profiles!schedule_days_employee_id_fkey(full_name)"
          )
          .gte("work_date", toDateInputValue(rangeStart))
          .lte("work_date", toDateInputValue(rangeEnd))
          .order("work_date", { ascending: true })
          .limit(500),
        supabase
          .from("shifts")
          .select(
            "id, employee_id, shift_date, started_at, ended_at, duration_minutes, status, profiles!shifts_employee_id_fkey(full_name)"
          )
          .order("started_at", { ascending: false })
          .limit(40),
        supabase
          .from("device_terminals")
          .select("id, device_name, device_code, is_active, location_label")
          .order("created_at", { ascending: false }),
      ]);

      const firstError =
        employeesResult.error ??
        scheduleResult.error ??
        shiftsResult.error ??
        terminalsResult.error;

      if (firstError) {
        setEmployees([]);
        setSchedule([]);
        setShifts([]);
        setDeviceTerminals([]);
        setMessage(firstError.message || "Не вдалося завантажити дані адміністратора.");
        return;
      }

      setEmployees((employeesResult.data ?? []) as EmployeeRow[]);
      setSchedule((scheduleResult.data ?? []) as ScheduleRow[]);
      setShifts((shiftsResult.data ?? []) as ShiftRow[]);
      setDeviceTerminals((terminalsResult.data ?? []) as DeviceTerminalRow[]);
    } catch (error) {
      setEmployees([]);
      setSchedule([]);
      setShifts([]);
      setDeviceTerminals([]);
      setMessage(error instanceof Error ? error.message : "Сталася помилка під час завантаження.");
    } finally {
      setLoading(false);
    }
  }

  async function loadPayrollSummary() {
    setSubmitting(true);
    setMessage(null);
    const result = await callAdminApiJson<{
      thresholdMinutes: number;
      overtimeMultiplier: number;
      rows: PayrollSummaryRow[];
    }>("/api/admin/payroll/summary", {
      periodStart: payrollRange.start,
      periodEnd: payrollRange.end,
    });
    setSubmitting(false);

    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося завантажити зарплатну зведену таблицю.");
      setPayrollSummary([]);
      setPayrollSummaryMeta(null);
      return;
    }

    setPayrollSummary(result.data.rows ?? []);
    setPayrollSummaryMeta({
      thresholdMinutes: Number(result.data.thresholdMinutes ?? 480),
      overtimeMultiplier: Number(result.data.overtimeMultiplier ?? 1.25),
    });
  }

  async function loadOvertimeRule() {
    const token = await getAccessToken();
    if (!token) return;
    const response = await fetch("/api/admin/pay-rules", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const payload = (await response.json()) as { rule?: OvertimeRule };
    if (payload.rule) setOvertimeRule(payload.rule);
  }

  async function loadOverview() {
    setSubmitting(true);
    setMessage(null);

    const token = await getAccessToken();
    if (!token) {
      setSubmitting(false);
      setMessage("Немає сесії адміністратора.");
      return;
    }

    const response = await fetch("/api/admin/analytics/overview", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ start: analyticsRange.start, end: analyticsRange.end }),
    });

    const payload = (await response.json()) as (AnalyticsOverview & { error?: string });
    setSubmitting(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Помилка завантаження аналітики.");
      return;
    }

    setOverview(payload);
  }

  useEffect(() => {
    loadCore();
    loadOvertimeRule();
  }, []);

  useEffect(() => {
    if (section !== "payroll") return;
    if (payrollSummaryLoaded) return;
    setPayrollSummaryLoaded(true);
    void loadPayrollSummary();
  }, [payrollSummaryLoaded, section]);

  useEffect(() => {
    if (section !== "dashboard" && section !== "reports") return;
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, analyticsRange.start, analyticsRange.end]);

  async function handleCreateEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/employees", {
      fullName: createEmployee.fullName,
      email: createEmployee.email,
      password: createEmployee.password,
      hourlyRate: Number(createEmployee.hourlyRate),
    });

    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося створити працівника.");
      return;
    }

    setCreateEmployee({ fullName: "", email: "", password: "", hourlyRate: "0" });
    await loadCore();
  }

  async function handleUpdateEmployee(employeeId: string, updates: any) {
    setSubmitting(true);
    setMessage(null);
    const result = await callAdminApi("/api/admin/employees/update", { employeeId, ...updates });
    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося оновити працівника.");
    await loadCore();
  }

  async function handleDeleteEmployee(employeeId: string) {
    setSubmitting(true);
    setMessage(null);
    const result = await callAdminApi("/api/admin/employees/delete", { employeeId });
    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося видалити працівника.");
    await loadCore();
  }

  async function handleCreateSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/schedule", {
      applyToAll: scheduleForm.applyToAll,
      employeeId: scheduleForm.employeeId,
      workDate: scheduleForm.workDate,
      dayType: scheduleForm.dayType,
      expectedStart: scheduleForm.expectedStart,
      expectedEnd: scheduleForm.expectedEnd,
    });

    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося зберегти день.");
    await loadCore();
  }

  async function handleManualShift() {
    setSubmitting(true);
    setMessage(null);
    const result = await callAdminApi("/api/admin/manual-shift", {
      employeeId: shiftControl.employeeId,
      action: shiftControl.action,
    });
    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося виконати дію.");
    await loadCore();
  }

  async function handleEmulatedScan() {
    setSubmitting(true);
    setMessage(null);
    const result = await callAdminApi("/api/admin/terminal", { employeeId: shiftControl.employeeId });
    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося виконати емульований scan.");
    await loadCore();
  }

  async function handleSavePayRules(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const result = await callAdminApi("/api/admin/pay-rules", {
      overtimeThresholdMinutesPerDay: overtimeRule.overtime_threshold_minutes_per_day,
      overtimeMultiplier: overtimeRule.overtime_multiplier,
    });
    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося зберегти правила.");
    await loadOvertimeRule();
  }

  async function handleCreatePayroll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/payroll", {
      employeeId: payrollForm.employeeId,
      periodStart: payrollForm.periodStart,
      periodEnd: payrollForm.periodEnd,
      bonuses: Number(payrollForm.bonuses),
      deductions: Number(payrollForm.deductions),
      notes: payrollForm.notes,
    });

    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося сформувати нарахування.");
    await loadCore();
  }

  async function handleCreateTerminal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/terminals", {
      deviceName: terminalForm.deviceName,
      deviceCode: terminalForm.deviceCode,
      secretKey: terminalForm.secretKey,
      locationLabel: terminalForm.locationLabel,
    });

    setSubmitting(false);
    if (!result.ok) setMessage(result.error ?? "Не вдалося додати термінал.");
    setTerminalForm({ deviceName: "", deviceCode: "", secretKey: "", locationLabel: "" });
    await loadCore();
  }

  async function handleExportShiftsCsv() {
    const token = await getAccessToken();
    if (!token) {
      setMessage("Немає сесії адміністратора.");
      return;
    }

    const url = `/api/admin/exports/shifts?start=${encodeURIComponent(analyticsRange.start)}&end=${encodeURIComponent(analyticsRange.end)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setMessage(payload.error ?? "Не вдалося сформувати експорт.");
      return;
    }

    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "shifts.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  if (loading) {
    return <section className="panel">Завантаження даних...</section>;
  }

  return (
    <>
      {message ? <section className="flash-message">{message}</section> : null}

      {section === "dashboard" ? (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span>Зараз на зміні</span>
              <strong>{employeesOnShift}</strong>
            </article>
            <article className="stat-card">
              <span>Сьогоднішні години</span>
              <strong>{(todaysMinutes / 60).toFixed(2)}</strong>
            </article>
            <article className="stat-card">
              <span>Працівники</span>
              <strong>{employees.length}</strong>
            </article>
            <article className="stat-card">
              <span>Очікувані виплати (місяць)</span>
              <strong>{overview ? formatMoney(expectedPayoutThisMonth) : "—"}</strong>
            </article>
          </section>

          <section className="grid">
            <article className="panel">
              <div className="panel-head">
                <p className="eyebrow">Today</p>
                <h2>Запізнення сьогодні</h2>
              </div>
              <p className="hint-text">У v1 показуємо метрику через “Звіти → Дисципліна”. Автоштрафів немає.</p>
            </article>

            <article className="panel">
              <div className="panel-head">
                <p className="eyebrow">Live</p>
                <h2>Останні check-in/out</h2>
              </div>
              <div className="schedule-table">
                {shifts.slice(0, 10).map((s) => (
                  <div key={s.id} className="table-row stack">
                    <strong>{profileName(s.profiles) ?? "Працівник"}</strong>
                    <span>{formatDate(s.shift_date)}</span>
                    <span>{formatDateTime(s.started_at)}</span>
                    <span>{s.ended_at ? formatDateTime(s.ended_at) : "Відкрита"}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}

      {section === "employees" ? (
        <>
          <section className="grid">
            <form className="panel span-2" onSubmit={handleCreateEmployee}>
              <div className="panel-head">
                <p className="eyebrow">Працівники</p>
                <h2>Додати працівника</h2>
              </div>
              <label className="field">
                <span>ПІБ</span>
                <input value={createEmployee.fullName} onChange={(e) => setCreateEmployee({ ...createEmployee, fullName: e.target.value })} required />
              </label>
              <label className="field">
                <span>Email</span>
                <input type="email" value={createEmployee.email} onChange={(e) => setCreateEmployee({ ...createEmployee, email: e.target.value })} required />
              </label>
              <label className="field">
                <span>Пароль</span>
                <input type="password" value={createEmployee.password} onChange={(e) => setCreateEmployee({ ...createEmployee, password: e.target.value })} required />
              </label>
              <label className="field">
                <span>Ставка</span>
                <input type="number" min="0" step="0.01" value={createEmployee.hourlyRate} onChange={(e) => setCreateEmployee({ ...createEmployee, hourlyRate: e.target.value })} required />
              </label>
              <button className="button button-primary full-width" disabled={submitting} type="submit">
                Створити
              </button>
            </form>
          </section>

          <section className="grid">
            <article className="panel large span-2">
              <div className="panel-head">
                <p className="eyebrow">Працівники</p>
                <h2>Редагування</h2>
              </div>
              <label className="field">
                <span>Пошук</span>
                <input
                  value={employeeQuery}
                  onChange={(e) => setEmployeeQuery(e.target.value)}
                  placeholder="Ім'я або email"
                />
              </label>
              <div className="schedule-table">
                {employees
                  .filter((employee) => {
                    const q = employeeQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      employee.full_name.toLowerCase().includes(q) ||
                      employee.email.toLowerCase().includes(q)
                    );
                  })
                  .map((employee) => (
                    <EditableEmployeeCardV2
                      key={employee.id}
                      employee={employee}
                      disabled={submitting}
                      onSave={handleUpdateEmployee}
                      onDelete={handleDeleteEmployee}
                    />
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}

      {section === "schedule" ? (
        <section className="grid">
          <form className="panel" onSubmit={handleCreateSchedule}>
            <div className="panel-head">
              <p className="eyebrow">Графік</p>
              <h2>Створення змін</h2>
            </div>
            <label className="field checkbox-row">
              <span>Для конкретної людини</span>
              <input
                type="checkbox"
                checked={!scheduleForm.applyToAll}
                onChange={(e) => setScheduleForm({ ...scheduleForm, applyToAll: !e.target.checked })}
              />
            </label>
            <label className="field">
              <span>Працівник</span>
              <select
                value={scheduleForm.employeeId}
                onChange={(e) => setScheduleForm({ ...scheduleForm, employeeId: e.target.value })}
                required={!scheduleForm.applyToAll}
                disabled={scheduleForm.applyToAll}
              >
                <option value="">Оберіть працівника</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дата</span>
              <input type="date" value={scheduleForm.workDate} onChange={(e) => setScheduleForm({ ...scheduleForm, workDate: e.target.value })} required />
            </label>
            <label className="field">
              <span>Тип дня</span>
              <select value={scheduleForm.dayType} onChange={(e) => setScheduleForm({ ...scheduleForm, dayType: e.target.value })}>
                <option value="required">Обов'язковий</option>
                <option value="preferred">Бажаний</option>
                <option value="off">Вихідний</option>
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Початок</span>
                <input type="time" value={scheduleForm.expectedStart} onChange={(e) => setScheduleForm({ ...scheduleForm, expectedStart: e.target.value })} />
              </label>
              <label className="field">
                <span>Кінець</span>
                <input type="time" value={scheduleForm.expectedEnd} onChange={(e) => setScheduleForm({ ...scheduleForm, expectedEnd: e.target.value })} />
              </label>
            </div>
            <button className="button button-primary full-width" disabled={submitting} type="submit">
              Зберегти
            </button>
          </form>

          <article className="panel">
            <div className="panel-head">
              <p className="eyebrow">Перегляд</p>
              <h2>Хто коли працює</h2>
            </div>
            <ScheduleByDate schedule={schedule} today={today} onReload={loadCore} setMessage={setMessage} />
          </article>
        </section>
      ) : null}

      {section === "time" ? (
        <section className="grid">
          <article className="panel">
            <div className="panel-head">
              <p className="eyebrow">Час</p>
              <h2>Ручний start/finish</h2>
            </div>
            <label className="field">
              <span>Працівник</span>
              <select value={shiftControl.employeeId} onChange={(e) => setShiftControl({ ...shiftControl, employeeId: e.target.value })}>
                <option value="">Оберіть працівника</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дія</span>
              <select value={shiftControl.action} onChange={(e) => setShiftControl({ ...shiftControl, action: e.target.value as "start" | "finish" })}>
                <option value="start">Почати зміну вручну</option>
                <option value="finish">Завершити зміну вручну</option>
              </select>
            </label>
            <div className="field-row">
              <button className="button button-primary full-width" type="button" onClick={handleManualShift} disabled={submitting}>
                Застосувати
              </button>
              <button className="button button-secondary full-width" type="button" onClick={handleEmulatedScan} disabled={submitting}>
                Емуляція scan
              </button>
            </div>
          </article>

          <article className="panel large">
            <div className="panel-head">
              <p className="eyebrow">Check-in/out</p>
              <h2>Таблиця (ручне редагування)</h2>
            </div>
            <ShiftEditorTable shifts={shifts} onSaved={loadCore} setMessage={setMessage} />
          </article>
        </section>
      ) : null}

      {section === "payroll" ? (
        <>
          <section className="grid">
            <form className="panel" onSubmit={handleSavePayRules}>
              <div className="panel-head">
                <p className="eyebrow">Зарплата</p>
                <h2>Правила</h2>
              </div>
              <label className="field">
                <span>Поріг хв/день</span>
                <input type="number" min={0} step={1} value={overtimeRule.overtime_threshold_minutes_per_day} onChange={(e) => setOvertimeRule({ ...overtimeRule, overtime_threshold_minutes_per_day: Number(e.target.value) })} required />
              </label>
              <label className="field">
                <span>Множник overtime</span>
                <input type="number" min={1} step={0.01} value={overtimeRule.overtime_multiplier} onChange={(e) => setOvertimeRule({ ...overtimeRule, overtime_multiplier: Number(e.target.value) })} required />
              </label>
              <button className="button button-primary full-width" disabled={submitting} type="submit">
                Зберегти
              </button>
            </form>
          </section>

          <section className="grid">
            <article className="panel large">
              <div className="panel-head">
                <p className="eyebrow">Payroll</p>
                <h2>Зведення по працівниках</h2>
              </div>

              <div className="analytics-toolbar">
                <label className="field">
                  <span>Початок</span>
                  <input type="date" value={payrollRange.start} onChange={(e) => setPayrollRange({ ...payrollRange, start: e.target.value })} />
                </label>
                <label className="field">
                  <span>Кінець</span>
                  <input type="date" value={payrollRange.end} onChange={(e) => setPayrollRange({ ...payrollRange, end: e.target.value })} />
                </label>
                <button className="button button-primary" type="button" onClick={loadPayrollSummary} disabled={submitting}>
                  Показати
                </button>
              </div>

              {payrollSummaryMeta ? (
                <p className="hint">
                  overtime: поріг {payrollSummaryMeta.thresholdMinutes} хв/день, множник {payrollSummaryMeta.overtimeMultiplier}
                </p>
              ) : null}

              <div className="schedule-table">
                <div className="table-row header payroll-row">
                  <strong>Працівник</strong>
                  <span>Відпрацьовано</span>
                  <span>У виплатах</span>
                  <span>До виплати</span>
                  <span>Сума (період)</span>
                  <span>До виплати</span>
                </div>
                {payrollSummary.map((row) => (
                  <div key={row.employeeId} className="table-row payroll-row">
                    <strong>{row.fullName}</strong>
                    <span>{formatHours(row.workedMinutes)}</span>
                    <span>{formatHours(row.coveredMinutes)}</span>
                    <span>{formatHours(row.uncoveredMinutes)}</span>
                    <span>{formatMoney(row.workedAmount)}</span>
                    <span className="money-strong">{formatMoney(row.uncoveredAmount)}</span>
                  </div>
                ))}
                {payrollSummary.length === 0 ? <p className="hint">Оберіть період і натисніть “Показати”.</p> : null}
              </div>

              {payrollSummary.length > 0 ? (
                <div className="panel-footer">
                  <span className="hint">
                    Разом:{" "}
                    {formatMoney(
                      payrollSummary.reduce((sum, r) => sum + Number(r.uncoveredAmount ?? 0), 0)
                    )}{" "}
                    до виплати за обраний період.
                  </span>
                </div>
              ) : null}
            </article>
          </section>

          <section className="grid">
            <form className="panel" onSubmit={handleCreatePayroll}>
              <div className="panel-head">
                <p className="eyebrow">Advanced</p>
                <h2>Сформувати нарахування (1 працівник)</h2>
              </div>
              <label className="field">
                <span>Працівник</span>
                <select value={payrollForm.employeeId} onChange={(e) => setPayrollForm({ ...payrollForm, employeeId: e.target.value })} required>
                  <option value="">Оберіть працівника</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Початок</span>
                  <input type="date" value={payrollForm.periodStart} onChange={(e) => setPayrollForm({ ...payrollForm, periodStart: e.target.value })} required />
                </label>
                <label className="field">
                  <span>Кінець</span>
                  <input type="date" value={payrollForm.periodEnd} onChange={(e) => setPayrollForm({ ...payrollForm, periodEnd: e.target.value })} required />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Бонуси</span>
                  <input type="number" step="0.01" value={payrollForm.bonuses} onChange={(e) => setPayrollForm({ ...payrollForm, bonuses: e.target.value })} />
                </label>
                <label className="field">
                  <span>Утримання</span>
                  <input type="number" step="0.01" value={payrollForm.deductions} onChange={(e) => setPayrollForm({ ...payrollForm, deductions: e.target.value })} />
                </label>
              </div>
              <label className="field">
                <span>Примітка</span>
                <input value={payrollForm.notes} onChange={(e) => setPayrollForm({ ...payrollForm, notes: e.target.value })} />
              </label>
              <button className="button button-secondary full-width" disabled={submitting} type="submit">
                Розрахувати
              </button>
            </form>
          </section>
        </>
      ) : null}

      {section === "reports" ? (
        <section className="grid">
          <article className="panel large">
            <div className="panel-head">
              <p className="eyebrow">Звіти</p>
              <h2>Аналітика + Excel</h2>
            </div>
            <div className="analytics-toolbar">
              <label className="field">
                <span>Початок</span>
                <input type="date" value={analyticsRange.start} onChange={(e) => setAnalyticsRange({ ...analyticsRange, start: e.target.value })} />
              </label>
              <label className="field">
                <span>Кінець</span>
                <input type="date" value={analyticsRange.end} onChange={(e) => setAnalyticsRange({ ...analyticsRange, end: e.target.value })} />
              </label>
              <button className="button button-primary" type="button" onClick={loadOverview} disabled={submitting}>
                Оновити
              </button>
              <button className="button button-secondary" type="button" onClick={handleExportShiftsCsv}>
                Excel (CSV)
              </button>
            </div>

            <div className="analytics-layout">
              <div className="chart-card">
                <div className="panel-head">
                  <p className="eyebrow">Топ</p>
                  <h2>Топ працівників</h2>
                </div>
                <div className="schedule-table">
                  {(overview?.topHours ?? []).map((row) => (
                    <div key={row.employee_id} className="table-row">
                      <strong>{row.full_name}</strong>
                      <span>{(row.total_minutes / 60).toFixed(2)} год</span>
                    </div>
                  ))}
                  {!overview ? <p>Натисни “Оновити”.</p> : null}
                </div>
              </div>

              <div className="chart-card">
                <div className="panel-head">
                  <p className="eyebrow">Дисципліна</p>
                  <h2>Найгірші</h2>
                </div>
                <div className="schedule-table">
                  {(overview?.disciplineBottom ?? []).map((row) => (
                    <div key={row.employeeId} className="table-row">
                      <strong>{row.fullName}</strong>
                      <span>{row.disciplineScore}/100</span>
                      <span>late: {row.lateCheckins}</span>
                    </div>
                  ))}
                  {!overview ? <p>Натисни “Оновити”.</p> : null}
                </div>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {section === "settings" ? (
        <>
          <section className="grid">
            <form className="panel" onSubmit={handleCreateTerminal}>
              <div className="panel-head">
                <p className="eyebrow">Налаштування</p>
                <h2>Trusted terminals</h2>
              </div>
              <label className="field">
                <span>Назва</span>
                <input value={terminalForm.deviceName} onChange={(e) => setTerminalForm({ ...terminalForm, deviceName: e.target.value })} required />
              </label>
              <label className="field">
                <span>Device code</span>
                <input value={terminalForm.deviceCode} onChange={(e) => setTerminalForm({ ...terminalForm, deviceCode: e.target.value })} required />
              </label>
              <label className="field">
                <span>Secret key</span>
                <input value={terminalForm.secretKey} onChange={(e) => setTerminalForm({ ...terminalForm, secretKey: e.target.value })} required />
              </label>
              <label className="field">
                <span>Локація</span>
                <input value={terminalForm.locationLabel} onChange={(e) => setTerminalForm({ ...terminalForm, locationLabel: e.target.value })} />
              </label>
              <button className="button button-primary full-width" disabled={submitting} type="submit">
                Додати
              </button>
            </form>
          </section>

          <section className="grid">
            <article className="panel large">
              <div className="panel-head">
                <p className="eyebrow">Налаштування</p>
                <h2>Список терміналів</h2>
              </div>
              <div className="schedule-table">
                {deviceTerminals.map((t) => (
                  <div key={t.id} className="table-row">
                    <strong>{t.device_name}</strong>
                    <span>{t.device_code}</span>
                    <span>{t.location_label || "—"}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </>
  );
}

function ScheduleByDate({
  schedule,
  today,
  onReload,
  setMessage,
}: {
  schedule: ScheduleRow[];
  today: string;
  onReload: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  const map = useMemo(() => {
    const out = new Map<string, ScheduleRow[]>();
    for (const row of schedule) {
      const date = row.work_date;
      if (!out.has(date)) out.set(date, []);
      out.get(date)!.push(row);
    }
    return out;
  }, [schedule]);

  const datesAsc = useMemo(() => Array.from(map.keys()).sort(), [map]);
  const pastDates = datesAsc.filter((d) => d < today).sort().reverse();
  const todayDates = datesAsc.filter((d) => d === today);
  const futureDates = datesAsc.filter((d) => d > today);

  const [editor, setEditor] = useState<{
    mode: "date" | "employee";
    workDate: string;
    employeeIds?: string[];
    employeeId?: string;
    anchor: { top: number; left: number };
  } | null>(null);
  const [dayType, setDayType] = useState<"required" | "preferred" | "off">("required");
  const [expectedStart, setExpectedStart] = useState("09:00");
  const [expectedEnd, setExpectedEnd] = useState("18:00");
  const [busy, setBusy] = useState(false);

  function openEditorForDate(workDate: string, entries: ScheduleRow[], e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 432));
    setDayType((entries[0]?.day_type as any) ?? "required");
    setExpectedStart(toTimeInput(entries[0]?.expected_start, "09:00"));
    setExpectedEnd(toTimeInput(entries[0]?.expected_end, "18:00"));
    setEditor({
      mode: "date",
      workDate,
      employeeIds: entries.map((row) => row.employee_id).filter(Boolean),
      anchor: { top: rect.bottom + 10, left },
    });
  }

  function openEditorForEmployee(workDate: string, employeeId: string, entry: ScheduleRow, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 432));
    setDayType((entry.day_type as any) ?? "required");
    setExpectedStart(toTimeInput(entry.expected_start, "09:00"));
    setExpectedEnd(toTimeInput(entry.expected_end, "18:00"));
    setEditor({ mode: "employee", workDate, employeeId, anchor: { top: rect.bottom + 10, left } });
  }

  async function saveEditor() {
    if (!editor) return;
    setBusy(true);
    const payload =
      editor.mode === "date"
        ? {
            employeeIds: editor.employeeIds ?? [],
            workDate: editor.workDate,
            dayType,
            expectedStart,
            expectedEnd,
          }
        : {
            applyToAll: false,
            employeeId: editor.employeeId,
            workDate: editor.workDate,
            dayType,
            expectedStart,
            expectedEnd,
          };

    const result = await callAdminApi("/api/admin/schedule", payload);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося зберегти зміну.");
      return;
    }
    setEditor(null);
    await onReload();
  }

  async function deleteEditor() {
    if (!editor) return;
    const sure =
      editor.mode === "date"
        ? window.confirm(`Видалити день ${formatDate(editor.workDate)} для всіх?`)
        : window.confirm(`Видалити день ${formatDate(editor.workDate)} для цього працівника?`);
    if (!sure) return;

    setBusy(true);
    const result = await callAdminApi("/api/admin/schedule/delete", {
      workDate: editor.workDate,
      applyToAll: editor.mode === "date",
      employeeId: editor.mode === "employee" ? editor.employeeId : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося видалити.");
      return;
    }
    setEditor(null);
    await onReload();
  }

  async function deleteDate(workDate: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const sure = window.confirm(`Видалити день ${formatDate(workDate)} для всіх працівників у цьому блоці?`);
    if (!sure) return;
    const entries = map.get(workDate) ?? [];
    setBusy(true);
    const result = await callAdminApi("/api/admin/schedule/delete", {
      workDate,
      employeeIds: entries.map((row) => row.employee_id).filter(Boolean),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося видалити.");
      return;
    }
    await onReload();
  }

  async function deleteEmployee(workDate: string, employeeId: string, employeeName: string | null, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const sure = window.confirm(
      `Видалити день ${formatDate(workDate)} для працівника ${employeeName ?? employeeId}?`
    );
    if (!sure) return;
    setBusy(true);
    const result = await callAdminApi("/api/admin/schedule/delete", {
      workDate,
      applyToAll: false,
      employeeId,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося видалити.");
      return;
    }
    await onReload();
  }

  if (!datesAsc.length) {
    return <p>Поки немає призначених змін у цьому діапазоні.</p>;
  }

  return (
    <div className="accordion-stack">
      {todayDates.map((date) => (
        <DateAccordion
          key={date}
          date={date}
          entries={map.get(date) ?? []}
          defaultOpen
          onEditDate={openEditorForDate}
          onEditEmployee={openEditorForEmployee}
          onDeleteDate={deleteDate}
          onDeleteEmployee={deleteEmployee}
        />
      ))}

      {futureDates.length ? <p className="accordion-section">Наступні дні</p> : null}
      {futureDates.map((date) => (
        <DateAccordion
          key={date}
          date={date}
          entries={map.get(date) ?? []}
          onEditDate={openEditorForDate}
          onEditEmployee={openEditorForEmployee}
          onDeleteDate={deleteDate}
          onDeleteEmployee={deleteEmployee}
        />
      ))}

      {pastDates.length ? (
        <details className="accordion accordion-muted">
          <summary className="accordion-summary">
            <span>Минулі дні</span>
            <span className="accordion-meta">{pastDates.length}</span>
          </summary>
          <div className="accordion-body">
            {pastDates.map((date) => (
              <DateAccordion
                key={date}
                date={date}
                entries={map.get(date) ?? []}
                muted
                onEditDate={openEditorForDate}
                onEditEmployee={openEditorForEmployee}
                onDeleteDate={deleteDate}
                onDeleteEmployee={deleteEmployee}
              />
            ))}
          </div>
        </details>
      ) : null}

      {editor ? (
        <>
          <button type="button" className="popover-scrim" onClick={() => setEditor(null)} />
          <div className="panel popover" style={{ top: editor.anchor.top, left: editor.anchor.left }}>
            <div className="panel-head">
              <p className="eyebrow">{editor.mode === "date" ? "Зміна дня" : "Зміна працівника"}</p>
              <h2>{formatDate(editor.workDate)}</h2>
            </div>
            <label className="field">
              <span>Тип дня</span>
              <select value={dayType} onChange={(e) => setDayType(e.target.value as any)}>
                <option value="required">Обов'язковий</option>
                <option value="preferred">Бажаний</option>
                <option value="off">Вихідний</option>
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Початок</span>
                <input type="time" value={expectedStart} onChange={(e) => setExpectedStart(e.target.value)} />
              </label>
              <label className="field">
                <span>Кінець</span>
                <input type="time" value={expectedEnd} onChange={(e) => setExpectedEnd(e.target.value)} />
              </label>
            </div>
            <div className="field-row">
              <button className="button button-primary full-width" type="button" disabled={busy} onClick={saveEditor}>
                Зберегти
              </button>
              <button className="button button-secondary full-width" type="button" disabled={busy} onClick={deleteEditor}>
                Видалити
              </button>
            </div>
            <p className="hint-text">Для “Видалити” буде запит підтвердження.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function DateAccordion({
  date,
  entries,
  defaultOpen = false,
  muted = false,
  onEditDate,
  onEditEmployee,
  onDeleteDate,
  onDeleteEmployee,
}: {
  date: string;
  entries: ScheduleRow[];
  defaultOpen?: boolean;
  muted?: boolean;
  onEditDate: (workDate: string, entries: ScheduleRow[], e: React.MouseEvent) => void;
  onEditEmployee: (workDate: string, employeeId: string, entry: ScheduleRow, e: React.MouseEvent) => void;
  onDeleteDate: (workDate: string, e: React.MouseEvent) => void;
  onDeleteEmployee: (workDate: string, employeeId: string, employeeName: string | null, e: React.MouseEvent) => void;
}) {
  const counts = countDayTypes(entries);
  const label = formatDate(date);

  return (
    <details className={muted ? "accordion accordion-sub accordion-is-muted" : "accordion"} open={defaultOpen}>
      <summary className="accordion-summary">
        <span className="accordion-summary-left">
          <span className="accordion-date">{label}</span>
          <span className="accordion-submeta">
            Обов'язкові: {counts.required} · Бажані: {counts.preferred} · Вихідні: {counts.off}
          </span>
        </span>
        <span className="accordion-summary-right">
          <span className="accordion-count">{counts.total}</span>
          <span className="accordion-people">людей</span>
          <span className="accordion-actions">
            <button className="button button-secondary" type="button" onClick={(e) => onEditDate(date, entries, e)}>
              Змінити
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={entries.length === 0}
              onClick={(e) => onDeleteDate(date, e)}
            >
              Видалити
            </button>
          </span>
        </span>
      </summary>
      <div className="accordion-body">
        <div className="schedule-table">
          {entries.map((item) => (
            <div key={item.id} className="table-row">
              <strong>{profileName(item.profiles) ?? "Працівник"}</strong>
              <span className={`pill pill-${item.day_type}`}>{item.day_type}</span>
              <span>
                {item.expected_start && item.expected_end ? `${item.expected_start} - ${item.expected_end}` : "Без часу"}
              </span>
              <span className="row-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={(e) => onEditEmployee(date, item.employee_id, item, e)}
                >
                  Змінити
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={(e) => onDeleteEmployee(date, item.employee_id, profileName(item.profiles), e)}
                >
                  Видалити
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function EditableEmployeeCardV2({
  employee,
  disabled,
  onSave,
  onDelete,
}: {
  employee: EmployeeRow;
  disabled: boolean;
  onSave: (employeeId: string, updates: any) => Promise<void>;
  onDelete: (employeeId: string) => Promise<void>;
}) {
  const settings = employeeSettingsValue(employee.employee_settings);
  const [open, setOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [fullName, setFullName] = useState(employee.full_name);
  const [email, setEmail] = useState(employee.email);
  const [password, setPassword] = useState("");
  const [hourlyRate, setHourlyRate] = useState(String(settings?.hourly_rate ?? 0));
  const [pinCode, setPinCode] = useState(settings?.pin_code ?? "");
  const [fingerprintId, setFingerprintId] = useState(settings?.fingerprint_id?.toString() ?? "");
  const [terminalAccessEnabled, setTerminalAccessEnabled] = useState(settings?.terminal_access_enabled ?? true);
  const [isActive, setIsActive] = useState(employee.is_active);

  useEffect(() => {
    const nextSettings = employeeSettingsValue(employee.employee_settings);
    setFullName(employee.full_name);
    setEmail(employee.email);
    setPassword("");
    setHourlyRate(String(nextSettings?.hourly_rate ?? 0));
    setPinCode(nextSettings?.pin_code ?? "");
    setFingerprintId(nextSettings?.fingerprint_id?.toString() ?? "");
    setTerminalAccessEnabled(nextSettings?.terminal_access_enabled ?? true);
    setIsActive(employee.is_active);
  }, [employee]);

  async function saveBase() {
    await onSave(employee.id, {
      fullName,
      email,
      hourlyRate: Number(hourlyRate),
      pinCode,
      fingerprintId: fingerprintId ? Number(fingerprintId) : null,
      terminalAccessEnabled,
      isActive,
    });
  }

  async function saveSecurity() {
    await onSave(employee.id, {
      fullName,
      email,
      password: password.trim() || undefined,
      hourlyRate: Number(hourlyRate),
      pinCode,
      fingerprintId: fingerprintId ? Number(fingerprintId) : null,
      terminalAccessEnabled,
      isActive,
    });
    setPassword("");
    setSecurityOpen(false);
  }

  function openSecurityModal() {
    const nextSettings = employeeSettingsValue(employee.employee_settings);
    setPinCode(nextSettings?.pin_code ?? "");
    setFingerprintId(nextSettings?.fingerprint_id?.toString() ?? "");
    setTerminalAccessEnabled(nextSettings?.terminal_access_enabled ?? true);
    setPassword("");
    setSecurityOpen(true);
  }

  return (
    <>
      <div className="editor-card">
        <div className="editor-card-head">
          <div className="editor-card-title">
            <strong>{fullName || employee.email}</strong>
            <span className="hint-text">{email}</span>
            <div className="employee-access-badges">
              <span className={fingerprintId ? "status-paid" : "status-unpaid"}>
                {fingerprintId ? `Fingerprint ID: ${fingerprintId}` : "Fingerprint ID не задано"}
              </span>
            </div>
          </div>
          <div className="editor-card-actions">
            <button className="button button-secondary" type="button" onClick={() => setOpen((v) => !v)}>
              {open ? "Згорнути" : "Розгорнути"}
            </button>
            <button className="button button-secondary" type="button" onClick={openSecurityModal}>
              Доступ і термінал
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={disabled}
              onClick={async () => {
                const sure = window.confirm(`Видалити працівника ${employee.email}? Це незворотно.`);
                if (!sure) return;
                await onDelete(employee.id);
              }}
            >
              Видалити
            </button>
          </div>
        </div>

        {open ? (
          <>
            <div className="field-row">
              <label className="field">
                <span>Ім'я</span>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </label>
              <label className="field">
                <span>Email</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Ставка</span>
                <input type="number" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
              </label>
              <label className="field checkbox-row">
                <span>Активний</span>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              </label>
            </div>
            <button className="button button-primary" type="button" disabled={disabled} onClick={saveBase}>
              Зберегти
            </button>
          </>
        ) : null}
      </div>

      {securityOpen ? (
        <>
          <button type="button" className="popover-scrim" onClick={() => setSecurityOpen(false)} />
          <div className="panel popover employee-security-modal">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Доступ працівника</p>
                <h2>{fullName || employee.email}</h2>
              </div>
            </div>

            <div className="field-row">
              <label className="field">
                <span>PIN</span>
                <input
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="5 цифр"
                />
              </label>
              <label className="field">
                <span>ID відбитка</span>
                <input
                  value={fingerprintId}
                  onChange={(e) => setFingerprintId(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Напр. 17"
                />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Новий пароль</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Залиш порожнім, якщо не змінюєш"
                />
              </label>
              <label className="field checkbox-row">
                <span>Доступ до термінала</span>
                <input
                  type="checkbox"
                  checked={terminalAccessEnabled}
                  onChange={(e) => setTerminalAccessEnabled(e.target.checked)}
                />
              </label>
            </div>

            <div className="hint-text">
              Поточний пароль не можна переглянути. Тут можна лише задати новий. `Fingerprint ID` підтягується автоматично з поточних налаштувань працівника.
            </div>

            <div className="field-row">
              <button className="button button-primary full-width" type="button" disabled={disabled} onClick={saveSecurity}>
                Зберегти доступ
              </button>
              <button
                className="button button-secondary full-width"
                type="button"
                onClick={() => {
                  setPassword("");
                  setSecurityOpen(false);
                }}
              >
                Скасувати
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function ShiftEditorTable({
  shifts,
  onSaved,
  setMessage,
}: {
  shifts: ShiftRow[];
  onSaved: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const current = shifts.find((s) => s.id === editingId) ?? null;
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [status, setStatus] = useState<"open" | "closed" | "flagged">("closed");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!current) return;
    setStartedAt(toLocalDateTimeInputValue(current.started_at));
    setEndedAt(current.ended_at ? toLocalDateTimeInputValue(current.ended_at) : "");
    setStatus((current.status as any) ?? (current.ended_at ? "closed" : "open"));
  }, [editingId]);

  async function save() {
    if (!editingId) return;
    setSaving(true);
    const result = await callAdminApi("/api/admin/shifts/update", {
      shiftId: editingId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: endedAt ? new Date(endedAt).toISOString() : null,
      status,
    });
    setSaving(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося оновити зміну.");
      return;
    }
    setEditingId(null);
    await onSaved();
  }

  return (
    <div className="schedule-table">
      {shifts.map((s) => (
        <div key={s.id} className="table-row stack">
          <strong>{profileName(s.profiles) ?? "Працівник"}</strong>
          <span>{formatDate(s.shift_date)}</span>
          <span>{formatDateTime(s.started_at)}</span>
          <span>{s.ended_at ? formatDateTime(s.ended_at) : "Відкрита"}</span>
          <span>{s.duration_minutes ? `${(s.duration_minutes / 60).toFixed(2)} год` : "—"}</span>
          <span>{s.status}</span>
          <button
            className="button button-secondary"
            type="button"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const left = Math.max(12, Math.min(rect.left, window.innerWidth - 432));
              setAnchor({ top: rect.bottom + 10, left });
              setEditingId(s.id);
            }}
          >
            Редагувати
          </button>
        </div>
      ))}

      {editingId ? (
        <>
          <button
            type="button"
            className="popover-scrim"
            onClick={() => {
              setEditingId(null);
              setAnchor(null);
            }}
          />
          <div className="panel popover" style={{ top: anchor?.top ?? 120, left: anchor?.left ?? 80 }}>
          <div className="panel-head">
            <p className="eyebrow">Edit</p>
            <h2>Редагування: {profileName(current?.profiles) ?? "Працівник"}</h2>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Start</span>
              <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </label>
            <label className="field">
              <span>End</span>
              <input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="open">open</option>
              <option value="closed">closed</option>
              <option value="flagged">flagged</option>
            </select>
          </label>
          <div className="field-row">
            <button className="button button-primary full-width" type="button" onClick={save} disabled={saving}>
              Зберегти
            </button>
            <button
              className="button button-secondary full-width"
              type="button"
              onClick={() => {
                setEditingId(null);
                setAnchor(null);
              }}
              disabled={saving}
            >
              Скасувати
            </button>
          </div>
          <p className="hint-text">Важливо: ended_at має бути не раніше started_at.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
