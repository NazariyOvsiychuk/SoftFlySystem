"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Topbar } from "@/components/topbar";
import { formatDate, formatDateTime, formatHours, formatMoney } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "employee";
};

type ScheduleDay = {
  id: string;
  work_date: string;
  day_type: "required" | "preferred" | "off";
  expected_start: string | null;
  expected_end: string | null;
};

type Shift = {
  id: string;
  shift_date: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  status: string;
};

type PayrollEntry = {
  id: string;
  final_amount: number;
  bonuses: number;
  deductions: number;
  total_minutes: number;
  details: Record<string, unknown>;
  period_start: string;
  period_end: string;
};

type Violation = {
  id: string;
  violation_type: string;
  violation_date: string;
  resolved: boolean;
};

function isShiftPaid(shiftDate: string, payrollEntries: PayrollEntry[]) {
  return payrollEntries.some((entry) => {
    const start = entry.period_start;
    const end = entry.period_end;

    if (!start || !end) {
      return false;
    }

    return shiftDate >= start && shiftDate <= end;
  });
}

export function EmployeeDashboard() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [showAllSchedule, setShowAllSchedule] = useState(false);
  const [showAllShifts, setShowAllShifts] = useState(false);
  const [showAllPayroll, setShowAllPayroll] = useState(false);
  const [showAllViolations, setShowAllViolations] = useState(false);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        return;
      }

      const userId = session.user.id;

      const [
        profileResult,
        scheduleResult,
        shiftsResult,
        payrollResult,
        violationsResult,
      ] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, role").eq("id", userId).single(),
        supabase
          .from("schedule_days")
          .select("id, work_date, day_type, expected_start, expected_end")
          .eq("employee_id", userId)
          .order("work_date", { ascending: false })
          .limit(14),
        supabase
          .from("shifts")
          .select("id, shift_date, started_at, ended_at, duration_minutes, status")
          .eq("employee_id", userId)
          .order("started_at", { ascending: false })
          .limit(30),
        supabase
          .rpc("employee_payroll_entries", { p_limit: 12 }),
        supabase
          .from("discipline_violations")
          .select("id, violation_type, violation_date, resolved")
          .eq("employee_id", userId)
          .order("violation_date", { ascending: false })
          .limit(10),
      ]);

      setProfile(profileResult.data as Profile);
      setSchedule((scheduleResult.data ?? []) as ScheduleDay[]);
      setShifts((shiftsResult.data ?? []) as Shift[]);
      setPayrollEntries((payrollResult.data ?? []) as PayrollEntry[]);
      setViolations((violationsResult.data ?? []) as Violation[]);
      setLoading(false);
    }

    load();
  }, []);

  const totalWorkedMinutes = useMemo(
    () =>
      shifts
        .filter((shift) => shift.status === "closed")
        .reduce((sum, shift) => sum + (shift.duration_minutes ?? 0), 0),
    [shifts]
  );

  const paidWorkedMinutes = useMemo(
    () =>
      shifts
        .filter((shift) => shift.status === "closed" && isShiftPaid(shift.shift_date, payrollEntries))
        .reduce((sum, shift) => sum + (shift.duration_minutes ?? 0), 0),
    [payrollEntries, shifts]
  );

  const unpaidWorkedMinutes = Math.max(0, totalWorkedMinutes - paidWorkedMinutes);
  const totalEarned = payrollEntries.reduce((sum, entry) => sum + entry.final_amount, 0);
  const activeViolations = violations.filter((item) => !item.resolved).length;
  const payoutCoverage = totalWorkedMinutes > 0 ? Math.round((paidWorkedMinutes / totalWorkedMinutes) * 100) : 0;
  const visibleSchedule = showAllSchedule ? schedule : schedule.slice(0, 5);
  const visibleShifts = showAllShifts ? shifts : shifts.slice(0, 6);
  const visiblePayrollEntries = showAllPayroll ? payrollEntries : payrollEntries.slice(0, 4);
  const visibleViolations = showAllViolations ? violations : violations.slice(0, 4);

  return (
    <AuthGuard allowedRoles={["employee"]}>
      <main className="dashboard-shell">
        <Topbar
          title={profile ? `Привіт, ${profile.full_name}` : "Кабінет працівника"}
          subtitle="Працівник"
          homeHref="/employee"
          links={[
            { href: "/", label: "Overview" },
            { href: "/employee", label: "My workspace" },
            { href: "/admin", label: "Admin view" },
          ]}
        />

        {loading ? (
          <section className="panel">Завантажуємо ваші дані...</section>
        ) : (
          <>
            <section className="stats-grid employee-stats-grid">
              <article className="stat-card">
                <span>Відпрацьовано всього</span>
                <strong>{formatHours(totalWorkedMinutes)}</strong>
              </article>
              <article className="stat-card">
                <span>Години у виплатах</span>
                <strong>{formatHours(paidWorkedMinutes)}</strong>
              </article>
              <article className="stat-card">
                <span>Ще не виплачено</span>
                <strong>{formatHours(unpaidWorkedMinutes)}</strong>
              </article>
              <article className="stat-card">
                <span>Отриманий заробіток</span>
                <strong>{formatMoney(totalEarned)}</strong>
              </article>
              <article className="stat-card">
                <span>Активні порушення</span>
                <strong>{activeViolations}</strong>
              </article>
            </section>

            <section className="grid">
              <article className="panel">
                <div className="panel-head">
                  <p className="eyebrow">Виплати</p>
                  <h2>Покриття виплат</h2>
                </div>
                <div className="progress-card">
                  <div className="progress-copy">
                    <strong>{payoutCoverage}%</strong>
                    <span>Закриті години, які вже входять у сформовані payroll-періоди.</span>
                  </div>
                  <div className="chart-track progress-track">
                    <div className="chart-bar" style={{ width: `${Math.max(payoutCoverage, 6)}%` }} />
                  </div>
                </div>
              </article>

              <article className="panel">
                <div className="panel-head">
                  <p className="eyebrow">Коротко</p>
                  <h2>Що варто перевірити</h2>
                </div>
                <div className="schedule-table">
                  <div className="table-row stack compact-info-card">
                    <strong>Графік</strong>
                    <span>Подивись найближчі дні та час виходу на зміну.</span>
                  </div>
                  <div className="table-row stack compact-info-card">
                    <strong>Зміни</strong>
                    <span>Перевір, які години вже увійшли у виплату, а які ще очікують.</span>
                  </div>
                  <div className="table-row stack compact-info-card">
                    <strong>Нарахування</strong>
                    <span>У зарплатних періодах видно суми, бонуси та штрафи.</span>
                  </div>
                </div>
              </article>
            </section>

            <section className="grid">
              <article className="panel large">
                <div className="panel-head">
                  <p className="eyebrow">Графік</p>
                  <h2>Останні призначені дні</h2>
                </div>
                <div className="schedule-table">
                  {visibleSchedule.map((item) => (
                    <div key={item.id} className="table-row">
                      <strong>{formatDate(item.work_date)}</strong>
                      <span className={`pill pill-${item.day_type}`}>{item.day_type}</span>
                      <span>
                        {item.expected_start && item.expected_end
                          ? `${item.expected_start} - ${item.expected_end}`
                          : "Без часу"}
                      </span>
                    </div>
                  ))}
                  {schedule.length === 0 ? <p>Графік ще не призначений.</p> : null}
                </div>
                {schedule.length > 5 ? (
                  <button type="button" className="button button-secondary employee-more-button" onClick={() => setShowAllSchedule((value) => !value)}>
                    {showAllSchedule ? "Показати менше" : `Показати ще ${schedule.length - visibleSchedule.length}`}
                  </button>
                ) : null}
              </article>

              <article className="panel">
                <div className="panel-head">
                  <p className="eyebrow">Зміни</p>
                  <h2>Відпрацьовані години</h2>
                </div>
                <div className="schedule-table">
                  {visibleShifts.map((item) => {
                    const paid = item.status === "closed" && isShiftPaid(item.shift_date, payrollEntries);

                    return (
                      <div key={item.id} className="table-row stack employee-list-card">
                        <strong>{formatDate(item.shift_date)}</strong>
                        <span>Початок: {formatDateTime(item.started_at)}</span>
                        <span>{item.ended_at ? `Завершення: ${formatDateTime(item.ended_at)}` : "Зміна відкрита"}</span>
                        <span>Тривалість: {item.duration_minutes ? formatHours(item.duration_minutes) : "..."}</span>
                        <span className={paid ? "status-paid" : "status-unpaid"}>
                          {item.status === "open"
                            ? "Ще триває"
                            : paid
                              ? "Увійшло у виплату"
                              : "Ще не включено у виплату"}
                        </span>
                      </div>
                    );
                  })}
                  {shifts.length === 0 ? <p>Змін поки немає.</p> : null}
                </div>
                {shifts.length > 6 ? (
                  <button type="button" className="button button-secondary employee-more-button" onClick={() => setShowAllShifts((value) => !value)}>
                    {showAllShifts ? "Показати менше" : `Показати ще ${shifts.length - visibleShifts.length}`}
                  </button>
                ) : null}
              </article>
            </section>

            <section className="grid">
              <article className="panel">
                <div className="panel-head">
                  <p className="eyebrow">Нарахування</p>
                  <h2>Зарплатні періоди</h2>
                </div>
                <div className="schedule-table">
                  {visiblePayrollEntries.map((entry) => (
                    <div key={entry.id} className="table-row stack employee-list-card">
                      <strong>{formatMoney(entry.final_amount)}</strong>
                      <span>
                        Період: {entry.period_start ?? "-"} - {entry.period_end ?? "-"}
                      </span>
                      <span>Години у виплаті: {formatHours(entry.total_minutes)}</span>
                      {typeof entry.details === "object" && entry.details ? (
                        <span>
                          Base:{" "}
                          {formatHours(Number((entry.details as any).base_minutes ?? 0))},{" "}
                          Overtime:{" "}
                          {formatHours(Number((entry.details as any).overtime_minutes ?? 0))}{" "}
                          ×{Number((entry.details as any).overtime_multiplier ?? 1).toFixed(2)}
                        </span>
                      ) : null}
                      <span>Бонуси: {formatMoney(entry.bonuses)}</span>
                      <span>Штрафи: {formatMoney(entry.deductions)}</span>
                    </div>
                  ))}
                  {payrollEntries.length === 0 ? <p>Нарахувань ще немає.</p> : null}
                </div>
                {payrollEntries.length > 4 ? (
                  <button type="button" className="button button-secondary employee-more-button" onClick={() => setShowAllPayroll((value) => !value)}>
                    {showAllPayroll ? "Показати менше" : `Показати ще ${payrollEntries.length - visiblePayrollEntries.length}`}
                  </button>
                ) : null}
              </article>

              <article className="panel">
                <div className="panel-head">
                  <p className="eyebrow">Дисципліна</p>
                  <h2>Статус графіку</h2>
                </div>
                <div className="schedule-table">
                  {visibleViolations.map((item) => (
                    <div key={item.id} className="table-row employee-violation-row">
                      <strong>{item.violation_type}</strong>
                      <span>{formatDate(item.violation_date)}</span>
                      <span>{item.resolved ? "Вирішено" : "Активне"}</span>
                    </div>
                  ))}
                  {violations.length === 0 ? <p>Порушень не зафіксовано.</p> : null}
                </div>
                {violations.length > 4 ? (
                  <button type="button" className="button button-secondary employee-more-button" onClick={() => setShowAllViolations((value) => !value)}>
                    {showAllViolations ? "Показати менше" : `Показати ще ${violations.length - visibleViolations.length}`}
                  </button>
                ) : null}
              </article>
            </section>
          </>
        )}
      </main>
    </AuthGuard>
  );
}
