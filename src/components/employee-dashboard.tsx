"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Topbar } from "@/components/topbar";
import { formatDate, formatDateTime, formatHours, formatMoney } from "@/lib/format";
import { getAccessToken, supabase } from "@/lib/supabase";

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
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  status: string;
  includedInPayroll?: boolean;
};

type PayrollEntry = {
  id: string;
  grossAmount: number;
  bonusesAmount: number;
  deductionsAmount: number;
  totalDue: number;
  paidAmount: number;
  balanceAmount: number;
  workedMinutes: number;
  snapshot: Record<string, unknown>;
  periodStart: string;
  periodEnd: string;
  runStatus: string;
};

type Violation = {
  id: string;
  violation_type: string;
  violation_date: string;
  resolved: boolean;
};

export function EmployeeDashboard() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [totals, setTotals] = useState({
    totalWorkedMinutes: 0,
    payrollWorkedMinutes: 0,
    unpaidWorkedMinutes: 0,
    totalAccruedAmount: 0,
    totalPaidAmount: 0,
    outstandingAmount: 0,
  });
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

      const token = await getAccessToken();
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await fetch("/api/employee/dashboard", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        profile?: Profile;
        schedule?: ScheduleDay[];
        shifts?: Shift[];
        payrollItems?: PayrollEntry[];
        violations?: Violation[];
        totals?: typeof totals;
      };

      if (!response.ok) {
        setLoading(false);
        return;
      }

      setProfile((payload.profile ?? null) as Profile | null);
      setSchedule((payload.schedule ?? []) as ScheduleDay[]);
      setShifts((payload.shifts ?? []) as Shift[]);
      setPayrollEntries((payload.payrollItems ?? []) as PayrollEntry[]);
      setViolations((payload.violations ?? []) as Violation[]);
      setTotals(payload.totals ?? totals);
      setLoading(false);
    }

    load();
  }, []);

  const activeViolations = violations.filter((item) => !item.resolved).length;
  const payoutCoverage =
    totals.totalAccruedAmount > 0
      ? Math.max(0, Math.min(100, Math.round((totals.totalPaidAmount / totals.totalAccruedAmount) * 100)))
      : 0;
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
                <strong>{formatHours(totals.totalWorkedMinutes)}</strong>
              </article>
              <article className="stat-card">
                <span>Години у payroll</span>
                <strong>{formatHours(totals.payrollWorkedMinutes)}</strong>
              </article>
              <article className="stat-card">
                <span>Ще не включено</span>
                <strong>{formatHours(totals.unpaidWorkedMinutes)}</strong>
              </article>
              <article className="stat-card">
                <span>Нараховано у payroll</span>
                <strong>{formatMoney(totals.totalAccruedAmount)}</strong>
              </article>
              <article className="stat-card">
                <span>Виплачено фактично</span>
                <strong>{formatMoney(totals.totalPaidAmount)}</strong>
              </article>
              <article className="stat-card">
                <span>Залишок до виплати</span>
                <strong>{formatMoney(totals.outstandingAmount)}</strong>
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
                    <span>Яка частина нарахованої суми вже фактично виплачена працівнику.</span>
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
                    const paid = item.status === "closed" && Boolean(item.includedInPayroll);

                    return (
                      <div key={item.id} className="table-row stack employee-list-card">
                        <strong>{formatDate(item.shiftDate)}</strong>
                        <span>Початок: {formatDateTime(item.startedAt)}</span>
                        <span>{item.endedAt ? `Завершення: ${formatDateTime(item.endedAt)}` : "Зміна відкрита"}</span>
                        <span>Тривалість: {item.durationMinutes ? formatHours(item.durationMinutes) : "..."}</span>
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
                      <strong>{formatMoney(entry.totalDue)}</strong>
                      <span>
                        Період: {entry.periodStart ?? "-"} - {entry.periodEnd ?? "-"}
                      </span>
                      <span>Години у payroll: {formatHours(entry.workedMinutes)}</span>
                      <span>Статус run: {entry.runStatus === "closed" ? "Закрито" : "Чернетка"}</span>
                      {typeof entry.snapshot === "object" && entry.snapshot ? (
                        <span>
                          Нараховано: {formatMoney(entry.grossAmount)} · Залишок: {formatMoney(entry.balanceAmount)}
                        </span>
                      ) : null}
                      <span>Бонуси: {formatMoney(entry.bonusesAmount)}</span>
                      <span>Штрафи: {formatMoney(entry.deductionsAmount)}</span>
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
