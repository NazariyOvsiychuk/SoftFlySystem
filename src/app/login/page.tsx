import { AuthGuard } from "@/components/auth-guard";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="center-shell login-shell">
      <AuthGuard allowGuest>
        <section className="login-grid">
          <article className="panel login-copy">
            <p className="eyebrow">Internal Access</p>
            <h1>Secure entry for administrators and employees</h1>
            <p className="lead">
              The platform is intentionally closed: employees are created by administrators, time events are tracked centrally, and payroll visibility stays transparent.
            </p>
            <div className="schedule-table">
              <div className="table-row stack">
                <strong>For administrators</strong>
                <span>People management, schedule control, analytics, payroll periods and terminal readiness.</span>
              </div>
              <div className="table-row stack">
                <strong>For employees</strong>
                <span>Worked hours, paid periods, current earnings and discipline visibility in one cabinet.</span>
              </div>
            </div>
          </article>
          <LoginForm />
        </section>
      </AuthGuard>
    </main>
  );
}
