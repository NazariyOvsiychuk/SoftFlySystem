"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
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
  work_date: string;
  day_type: string;
  // Supabase nested selects often return arrays even for many-to-one unless typed via generated types.
  profiles: Array<{
    full_name: string;
  }> | null;
};

type ShiftRow = {
  id: string;
  employee_id?: string;
  shift_date: string;
  started_at?: string;
  ended_at?: string | null;
  duration_minutes: number | null;
  status: string;
  profiles: Array<{
    full_name: string;
  }> | null;
};

type DeviceTerminalRow = {
  id: string;
  device_name: string;
  device_code: string;
  is_active: boolean;
  location_label: string | null;
};

type AnalyticsShiftRow = {
  id: string;
  employee_id: string;
  shift_date: string;
  duration_minutes: number | null;
  profiles: Array<{
    full_name: string;
  }> | null;
};

type PayrollForm = {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  bonuses: string;
  deductions: string;
  notes: string;
};

type TerminalForm = {
  deviceName: string;
  deviceCode: string;
  secretKey: string;
  locationLabel: string;
};

type OvertimeRule = {
  overtime_threshold_minutes_per_day: number;
  overtime_multiplier: number;
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

function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export function AdminDashboard({ section = "overview" }: { section?: AdminSection }) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [analyticsShifts, setAnalyticsShifts] = useState<AnalyticsShiftRow[]>([]);
  const [deviceTerminals, setDeviceTerminals] = useState<DeviceTerminalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState({
    start: toDateInputValue(monthStart),
    end: toDateInputValue(now),
  });
  const [overtimeRule, setOvertimeRule] = useState<OvertimeRule>({
    overtime_threshold_minutes_per_day: 480,
    overtime_multiplier: 1.25,
  });
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    hourlyRate: "0",
  });
  const [scheduleForm, setScheduleForm] = useState({
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
  const [payrollForm, setPayrollForm] = useState<PayrollForm>({
    employeeId: "",
    periodStart: "",
    periodEnd: "",
    bonuses: "0",
    deductions: "0",
    notes: "",
  });
  const [terminalForm, setTerminalForm] = useState<TerminalForm>({
    deviceName: "",
    deviceCode: "",
    secretKey: "",
    locationLabel: "",
  });

  async function loadData() {
    setLoading(true);

    const [employeesResult, scheduleResult, shiftsResult, terminalsResult] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, full_name, email, is_active, employee_settings(hourly_rate,pin_code,fingerprint_id,terminal_access_enabled)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("schedule_days")
        .select("id, work_date, day_type, profiles!schedule_days_employee_id_fkey(full_name)")
        .order("work_date", { ascending: false })
        .limit(12),
      supabase
        .from("shifts")
        .select(
          "id, shift_date, started_at, ended_at, duration_minutes, status, profiles!shifts_employee_id_fkey(full_name)"
        )
        .order("started_at", { ascending: false })
        .limit(12),
      supabase
        .from("device_terminals")
        .select("id, device_name, device_code, is_active, location_label")
        .order("created_at", { ascending: false }),
    ]);

    setEmployees((employeesResult.data ?? []) as EmployeeRow[]);
    setSchedule((scheduleResult.data ?? []) as ScheduleRow[]);
    setShifts((shiftsResult.data ?? []) as ShiftRow[]);
    setDeviceTerminals((terminalsResult.data ?? []) as DeviceTerminalRow[]);
    setLoading(false);
  }

  async function loadAnalytics(range = analyticsRange) {
    const { data } = await supabase
      .from("shifts")
      .select("id, employee_id, shift_date, duration_minutes, profiles!shifts_employee_id_fkey(full_name)")
      .gte("shift_date", range.start)
      .lte("shift_date", range.end)
      .eq("status", "closed")
      .order("shift_date", { ascending: false });

    setAnalyticsShifts((data ?? []) as AnalyticsShiftRow[]);
  }

  useEffect(() => {
    loadData();
    loadAnalytics();
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch("/api/admin/pay-rules", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { rule?: OvertimeRule };
      if (payload.rule) setOvertimeRule(payload.rule);
    })();
  }, []);

  const employeesOnShift = useMemo(
    () => shifts.filter((shift) => shift.status === "open").length,
    [shifts]
  );
  const employeesWithTerminalPin = useMemo(
    () => employees.filter((employee) => employee.employee_settings?.[0]?.pin_code).length,
    [employees]
  );
  const employeesTerminalReady = useMemo(
    () =>
      employees.filter((employee) => {
        const settings = employee.employee_settings?.[0];
        return Boolean(settings?.pin_code && settings?.fingerprint_id && settings.terminal_access_enabled);
      }).length,
    [employees]
  );
  const activeDeviceTerminals = useMemo(
    () => deviceTerminals.filter((terminal) => terminal.is_active).length,
    [deviceTerminals]
  );

  const analyticsRows = useMemo(() => {
    const totals = new Map<
      string,
      { employeeId: string; fullName: string; totalMinutes: number }
    >();

    for (const shift of analyticsShifts) {
      const current = totals.get(shift.employee_id) ?? {
        employeeId: shift.employee_id,
        fullName: shift.profiles?.[0]?.full_name ?? "Працівник",
        totalMinutes: 0,
      };

      current.totalMinutes += shift.duration_minutes ?? 0;
      totals.set(shift.employee_id, current);
    }

    return Array.from(totals.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [analyticsShifts]);

  const topTenRows = analyticsRows.slice(0, 10);
  const topMaxMinutes = topTenRows[0]?.totalMinutes ?? 0;

  async function callAdminApi(path: string, body: object) {
    const token = await getAccessToken();

    if (!token) {
      setMessage("Немає сесії адміністратора.");
      return { ok: false };
    }

    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as { error?: string; message?: string };
    setMessage(payload.error ?? payload.message ?? null);

    return { ok: response.ok };
  }

  async function handleCreateEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/employees", {
      fullName: form.fullName,
      email: form.email,
      password: form.password,
      hourlyRate: Number(form.hourlyRate),
    });

    setSubmitting(false);

    if (result.ok) {
      setForm({ fullName: "", email: "", password: "", hourlyRate: "0" });
      await loadData();
    }
  }

  async function handleCreateSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/schedule", {
      employeeId: scheduleForm.employeeId,
      workDate: scheduleForm.workDate,
      dayType: scheduleForm.dayType,
      expectedStart: scheduleForm.expectedStart,
      expectedEnd: scheduleForm.expectedEnd,
    });

    setSubmitting(false);

    if (result.ok) {
      await loadData();
    }
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

    if (result.ok) {
      await loadData();
    }
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
    if (result.ok) await loadData();
  }

  async function handleLoadOverview() {
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ start: analyticsRange.start, end: analyticsRange.end }),
    });

    const payload = (await response.json()) as AnalyticsOverview & { error?: string };
    setSubmitting(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Помилка завантаження аналітики.");
      return;
    }

    setOverview(payload);
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

  async function handleManualShift() {
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/manual-shift", {
      employeeId: shiftControl.employeeId,
      action: shiftControl.action,
    });

    setSubmitting(false);

    if (result.ok) {
      await loadData();
    }
  }

  async function handleEmulatedScan() {
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/terminal", {
      employeeId: shiftControl.employeeId,
    });

    setSubmitting(false);

    if (result.ok) {
      await loadData();
    }
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

    if (result.ok) {
      setTerminalForm({
        deviceName: "",
        deviceCode: "",
        secretKey: "",
        locationLabel: "",
      });
      await loadData();
    }
  }

  async function handleUpdateEmployee(
    employeeId: string,
    updates: {
      fullName: string;
      hourlyRate: number;
      pinCode: string;
      fingerprintId: number | null;
      terminalAccessEnabled: boolean;
      isActive: boolean;
    }
  ) {
    setSubmitting(true);
    setMessage(null);

    const result = await callAdminApi("/api/admin/employees/update", {
      employeeId,
      ...updates,
    });

    setSubmitting(false);

    if (result.ok) {
      await loadData();
    }
  }

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <main className="dashboard-shell">
        <Topbar
          title="Control center"
          subtitle="Administrator"
          homeHref="/admin"
          links={[
            { href: "/", label: "Overview" },
            { href: "/admin", label: "Admin" },
            { href: "/employee", label: "Employee view" },
          ]}
        />

        {message ? <section className="flash-message">{message}</section> : null}

        <section className="stats-grid">
          <article className="stat-card">
            <span>Працівники</span>
            <strong>{employees.length}</strong>
          </article>
          <article className="stat-card">
            <span>Зараз на зміні</span>
            <strong>{employeesOnShift}</strong>
          </article>
          <article className="stat-card">
            <span>План змін</span>
            <strong>{schedule.length}</strong>
          </article>
          <article className="stat-card">
            <span>Активні термінали</span>
            <strong>{activeDeviceTerminals}</strong>
          </article>
        </section>

        <section className="grid">
          <article className="panel">
            <div className="panel-head">
              <p className="eyebrow">Readiness</p>
              <h2>Стан готовності системи</h2>
            </div>
            <div className="readiness-grid">
              <div className="readiness-card">
                <span>З PIN-кодом</span>
                <strong>{employeesWithTerminalPin}</strong>
              </div>
              <div className="readiness-card">
                <span>Готові до термінала</span>
                <strong>{employeesTerminalReady}</strong>
              </div>
              <div className="readiness-card">
                <span>Довірені пристрої</span>
                <strong>{deviceTerminals.length}</strong>
              </div>
              <div className="readiness-card">
                <span>Відкриті зміни</span>
                <strong>{employeesOnShift}</strong>
              </div>
            </div>
          </article>

          <form className="panel" onSubmit={handleCreateTerminal}>
            <div className="panel-head">
              <p className="eyebrow">Devices</p>
              <h2>Додати trusted terminal</h2>
            </div>
            <label className="field">
              <span>Назва пристрою</span>
              <input
                value={terminalForm.deviceName}
                onChange={(event) => setTerminalForm({ ...terminalForm, deviceName: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Device code</span>
              <input
                value={terminalForm.deviceCode}
                onChange={(event) => setTerminalForm({ ...terminalForm, deviceCode: event.target.value })}
                placeholder="pi-front-desk"
                required
              />
            </label>
            <label className="field">
              <span>Secret key</span>
              <input
                value={terminalForm.secretKey}
                onChange={(event) => setTerminalForm({ ...terminalForm, secretKey: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Локація</span>
              <input
                value={terminalForm.locationLabel}
                onChange={(event) => setTerminalForm({ ...terminalForm, locationLabel: event.target.value })}
              />
            </label>
            <button className="button button-primary full-width" type="submit" disabled={submitting}>
              Додати термінал
            </button>
          </form>
        </section>

        <section className="grid">
          <article className="panel large">
            <div className="panel-head">
              <p className="eyebrow">Devices</p>
              <h2>Довірені термінали</h2>
            </div>
            <div className="schedule-table">
              {deviceTerminals.map((terminal) => (
                <div key={terminal.id} className="table-row">
                  <strong>{terminal.device_name}</strong>
                  <span>{terminal.device_code}</span>
                  <span>{terminal.location_label || "Без локації"}</span>
                </div>
              ))}
              {!loading && deviceTerminals.length === 0 ? <p>Додай хоча б один trusted terminal.</p> : null}
            </div>
          </article>
        </section>

        <section className="grid">
          <article className="panel large">
            <div className="panel-head">
              <p className="eyebrow">Analytics</p>
              <h2>Де ви втрачаєте гроші</h2>
            </div>
            <div className="analytics-toolbar">
              <label className="field">
                <span>Початок</span>
                <input
                  type="date"
                  value={analyticsRange.start}
                  onChange={(event) =>
                    setAnalyticsRange({ ...analyticsRange, start: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Кінець</span>
                <input
                  type="date"
                  value={analyticsRange.end}
                  onChange={(event) =>
                    setAnalyticsRange({ ...analyticsRange, end: event.target.value })
                  }
                />
              </label>
              <button
                className="button button-primary"
                type="button"
                onClick={async () => {
                  await loadAnalytics(analyticsRange);
                  await handleLoadOverview();
                }}
              >
                Оновити аналітику
              </button>
              <button className="button button-secondary" type="button" onClick={handleExportShiftsCsv}>
                Export shifts (CSV)
              </button>
            </div>

            <div className="analytics-layout">
              <div className="schedule-table">
                {analyticsRows.map((row) => (
                  <div key={row.employeeId} className="table-row">
                    <strong>{row.fullName}</strong>
                    <span>{(row.totalMinutes / 60).toFixed(2)} год</span>
                    <span>{row.totalMinutes} хв</span>
                  </div>
                ))}
                {analyticsRows.length === 0 ? <p>За цей період ще немає закритих змін.</p> : null}
              </div>

              <div className="chart-card">
                <div className="panel-head">
                  <p className="eyebrow">Top 10</p>
                  <h2>Найбільша кількість годин</h2>
                </div>
                <div className="chart-list">
                  {topTenRows.map((row) => (
                    <div key={row.employeeId} className="chart-row">
                      <div className="chart-meta">
                        <strong>{row.fullName}</strong>
                        <span>{(row.totalMinutes / 60).toFixed(2)} год</span>
                      </div>
                      <div className="chart-track">
                        <div
                          className="chart-bar"
                          style={{
                            width:
                              topMaxMinutes > 0
                                ? `${Math.max(10, (row.totalMinutes / topMaxMinutes) * 100)}%`
                                : "0%",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {topTenRows.length === 0 ? <p>Поки немає даних для графіка.</p> : null}
                </div>
              </div>
            </div>

            {overview ? (
              <div className="analytics-layout" style={{ marginTop: 20 }}>
                <div className="chart-card">
                  <div className="panel-head">
                    <p className="eyebrow">Discipline</p>
                    <h2>Ефективні (discipline score)</h2>
                  </div>
                  <div className="schedule-table">
                    {overview.disciplineTop.map((row) => (
                      <div key={row.employeeId} className="table-row">
                        <strong>{row.fullName}</strong>
                        <span>{row.disciplineScore}/100</span>
                        <span>late: {row.lateCheckins}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="chart-card">
                  <div className="panel-head">
                    <p className="eyebrow">Losses</p>
                    <h2>Витрати на персонал по днях</h2>
                  </div>
                  <div className="chart-list">
                    {overview.laborCostByDay.slice(-14).map((row) => {
                      const max = Math.max(...overview.laborCostByDay.map((d) => Number(d.total_amount ?? 0)), 0);
                      const pct = max > 0 ? (Number(row.total_amount ?? 0) / max) * 100 : 0;
                      return (
                        <div key={row.work_date} className="chart-row">
                          <div className="chart-meta">
                            <strong>{row.work_date}</strong>
                            <span>{Number(row.total_amount ?? 0).toFixed(2)}</span>
                          </div>
                          <div className="chart-track">
                            <div className="chart-bar" style={{ width: `${Math.max(6, pct)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {!overview.laborCostByDay.length ? <p>Немає даних витрат за період.</p> : null}
                  </div>
                </div>
              </div>
            ) : null}
          </article>
        </section>

        <section className="grid">
          <form className="panel" onSubmit={handleSavePayRules}>
            <div className="panel-head">
              <p className="eyebrow">Payroll rules</p>
              <h2>Понаднормові (v1)</h2>
            </div>
            <label className="field">
              <span>Поріг хв/день</span>
              <input
                type="number"
                min={0}
                step={1}
                value={overtimeRule.overtime_threshold_minutes_per_day}
                onChange={(event) =>
                  setOvertimeRule({
                    ...overtimeRule,
                    overtime_threshold_minutes_per_day: Number(event.target.value),
                  })
                }
                required
              />
            </label>
            <label className="field">
              <span>Множник overtime</span>
              <input
                type="number"
                min={1}
                step={0.01}
                value={overtimeRule.overtime_multiplier}
                onChange={(event) =>
                  setOvertimeRule({
                    ...overtimeRule,
                    overtime_multiplier: Number(event.target.value),
                  })
                }
                required
              />
            </label>
            <button className="button button-primary full-width" type="submit" disabled={submitting}>
              Зберегти правила
            </button>
            <p className="hint-text">
              Автоштрафи ще не генеруються. Це лише формула розрахунку gross по payroll.
            </p>
          </form>
        </section>

        <section className="grid">
          <form className="panel" onSubmit={handleCreateEmployee}>
            <div className="panel-head">
              <p className="eyebrow">Users</p>
              <h2>Створити працівника</h2>
            </div>
            <label className="field">
              <span>ПІБ</span>
              <input
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Ставка за годину</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.hourlyRate}
                onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })}
                required
              />
            </label>
            <button className="button button-primary full-width" disabled={submitting} type="submit">
              Створити працівника
            </button>
          </form>

          <form className="panel" onSubmit={handleCreateSchedule}>
            <div className="panel-head">
              <p className="eyebrow">Schedule</p>
              <h2>Призначити день</h2>
            </div>
            <label className="field">
              <span>Працівник</span>
              <select
                value={scheduleForm.employeeId}
                onChange={(event) => setScheduleForm({ ...scheduleForm, employeeId: event.target.value })}
                required
              >
                <option value="">Оберіть працівника</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дата</span>
              <input
                type="date"
                value={scheduleForm.workDate}
                onChange={(event) => setScheduleForm({ ...scheduleForm, workDate: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Тип дня</span>
              <select
                value={scheduleForm.dayType}
                onChange={(event) => setScheduleForm({ ...scheduleForm, dayType: event.target.value })}
              >
                <option value="required">Обов'язковий</option>
                <option value="preferred">Бажаний</option>
                <option value="off">Вихідний</option>
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Початок</span>
                <input
                  type="time"
                  value={scheduleForm.expectedStart}
                  onChange={(event) =>
                    setScheduleForm({ ...scheduleForm, expectedStart: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Кінець</span>
                <input
                  type="time"
                  value={scheduleForm.expectedEnd}
                  onChange={(event) =>
                    setScheduleForm({ ...scheduleForm, expectedEnd: event.target.value })
                  }
                />
              </label>
            </div>
            <button className="button button-primary full-width" disabled={submitting} type="submit">
              Зберегти день
            </button>
          </form>
        </section>

        <section className="grid">
          <article className="panel">
            <div className="panel-head">
              <p className="eyebrow">Shift Control</p>
              <h2>Ручний старт або фініш</h2>
            </div>
            <label className="field">
              <span>Працівник</span>
              <select
                value={shiftControl.employeeId}
                onChange={(event) => setShiftControl({ ...shiftControl, employeeId: event.target.value })}
              >
                <option value="">Оберіть працівника</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дія</span>
              <select
                value={shiftControl.action}
                onChange={(event) =>
                  setShiftControl({ ...shiftControl, action: event.target.value as "start" | "finish" })
                }
              >
                <option value="start">Почати зміну вручну</option>
                <option value="finish">Завершити зміну вручну</option>
              </select>
            </label>
            <div className="field-row">
              <button className="button button-primary full-width" type="button" onClick={handleManualShift}>
                Застосувати
              </button>
              <button className="button button-secondary full-width" type="button" onClick={handleEmulatedScan}>
                Емуляція scan
              </button>
            </div>
            <p className="hint-text">
              Автоматичних штрафів немає. Ручний режим потрібен для технічних збоїв або виняткових кейсів.
            </p>
          </article>

          <article className="panel">
            <div className="panel-head">
              <p className="eyebrow">Terminal Readiness</p>
              <h2>Raspberry Pi foundation</h2>
            </div>
            <ul className="feature-list">
              <li>У кожного працівника є PIN-код для термінала.</li>
              <li>Термінальний доступ можна вимкнути окремо для працівника.</li>
              <li>Сервер повертає наступну дію: `start` або `finish`.</li>
              <li>Підтвердження відбитка пальця може лишатися на Raspberry Pi.</li>
            </ul>
          </article>
        </section>

        <section className="grid">
          <article className="panel large">
            <div className="panel-head">
              <p className="eyebrow">Employees</p>
              <h2>Редагування параметрів працівника</h2>
            </div>
            <div className="schedule-table">
              {employees.map((employee) => (
                <EditableEmployeeCard
                  key={employee.id}
                  employee={employee}
                  onSave={handleUpdateEmployee}
                  disabled={submitting}
                />
              ))}
              {!loading && employees.length === 0 ? <p>Працівників ще немає.</p> : null}
            </div>
          </article>
        </section>

        <section className="grid">
          <article className="panel">
            <div className="panel-head">
              <p className="eyebrow">Recent Schedule</p>
              <h2>Останні календарні записи</h2>
            </div>
            <div className="schedule-table">
              {schedule.map((item) => (
                <div key={item.id} className="table-row">
                  <strong>{item.profiles?.[0]?.full_name ?? "Працівник"}</strong>
                  <span>{formatDate(item.work_date)}</span>
                  <span className={`pill pill-${item.day_type}`}>{item.day_type}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <p className="eyebrow">Recent Shifts</p>
              <h2>Фактичний час</h2>
            </div>
            <div className="schedule-table">
              {shifts.map((item) => (
                <div key={item.id} className="table-row">
                  <strong>{item.profiles?.[0]?.full_name ?? "Працівник"}</strong>
                  <span>{formatDate(item.shift_date)}</span>
                  <span>{item.status === "open" ? "Відкрита" : `${item.duration_minutes ?? 0} хв`}</span>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid">
          <form className="panel" onSubmit={handleCreatePayroll}>
            <div className="panel-head">
              <p className="eyebrow">Payroll</p>
              <h2>Нарахування з бонусами й штрафами</h2>
            </div>
            <label className="field">
              <span>Працівник</span>
              <select
                value={payrollForm.employeeId}
                onChange={(event) => setPayrollForm({ ...payrollForm, employeeId: event.target.value })}
                required
              >
                <option value="">Оберіть працівника</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Початок періоду</span>
                <input
                  type="date"
                  value={payrollForm.periodStart}
                  onChange={(event) =>
                    setPayrollForm({ ...payrollForm, periodStart: event.target.value })
                  }
                  required
                />
              </label>
              <label className="field">
                <span>Кінець періоду</span>
                <input
                  type="date"
                  value={payrollForm.periodEnd}
                  onChange={(event) =>
                    setPayrollForm({ ...payrollForm, periodEnd: event.target.value })
                  }
                  required
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Бонуси</span>
                <input
                  type="number"
                  step="0.01"
                  value={payrollForm.bonuses}
                  onChange={(event) =>
                    setPayrollForm({ ...payrollForm, bonuses: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Штрафи</span>
                <input
                  type="number"
                  step="0.01"
                  value={payrollForm.deductions}
                  onChange={(event) =>
                    setPayrollForm({ ...payrollForm, deductions: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="field">
              <span>Примітка</span>
              <input
                value={payrollForm.notes}
                onChange={(event) => setPayrollForm({ ...payrollForm, notes: event.target.value })}
              />
            </label>
            <button className="button button-primary full-width" disabled={submitting} type="submit">
              Розрахувати нарахування
            </button>
          </form>
        </section>
      </main>
    </AuthGuard>
  );
}

function EditableEmployeeCard({
  employee,
  onSave,
  disabled,
}: {
  employee: EmployeeRow;
  onSave: (
    employeeId: string,
    updates: {
      fullName: string;
      hourlyRate: number;
      pinCode: string;
      fingerprintId: number | null;
      terminalAccessEnabled: boolean;
      isActive: boolean;
    }
  ) => Promise<void>;
  disabled: boolean;
}) {
  const [fullName, setFullName] = useState(employee.full_name);
  const [hourlyRate, setHourlyRate] = useState(String(employee.employee_settings?.[0]?.hourly_rate ?? 0));
  const [pinCode, setPinCode] = useState(employee.employee_settings?.[0]?.pin_code ?? "");
  const [fingerprintId, setFingerprintId] = useState(
    employee.employee_settings?.[0]?.fingerprint_id?.toString() ?? ""
  );
  const [terminalAccessEnabled, setTerminalAccessEnabled] = useState(
    employee.employee_settings?.[0]?.terminal_access_enabled ?? true
  );
  const [isActive, setIsActive] = useState(employee.is_active);

  return (
    <div className="editor-card">
      <strong>{employee.email}</strong>
      <div className="field-row">
        <label className="field">
          <span>Ім'я</span>
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </label>
        <label className="field">
          <span>Ставка</span>
          <input
            type="number"
            step="0.01"
            value={hourlyRate}
            onChange={(event) => setHourlyRate(event.target.value)}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>PIN для термінала</span>
          <input
            value={pinCode}
            onChange={(event) => setPinCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="5 цифр"
          />
        </label>
        <label className="field">
          <span>ID відбитка</span>
          <input
            value={fingerprintId}
            onChange={(event) =>
              setFingerprintId(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="Напр. 17"
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field checkbox-row">
          <span>Доступ до термінала</span>
          <input
            type="checkbox"
            checked={terminalAccessEnabled}
            onChange={(event) => setTerminalAccessEnabled(event.target.checked)}
          />
        </label>
        <label className="field checkbox-row">
          <span>Активний профіль</span>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
        </label>
      </div>
      <button
        className="button button-primary"
        type="button"
        disabled={disabled}
        onClick={() =>
          onSave(employee.id, {
            fullName,
            hourlyRate: Number(hourlyRate),
            pinCode,
            fingerprintId: fingerprintId ? Number(fingerprintId) : null,
            terminalAccessEnabled,
            isActive,
          })
        }
      >
        Зберегти зміни
      </button>
    </div>
  );
}
