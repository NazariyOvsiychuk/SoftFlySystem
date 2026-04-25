"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type HomeRole = "admin" | "employee" | null;

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<HomeRole>(null);
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setIsAuthenticated(false);
        setRole(null);
        setFullName("");
        setLoading(false);
        return;
      }

      setIsAuthenticated(true);
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", session.user.id)
        .maybeSingle();

      setRole((profile?.role as HomeRole) ?? null);
      setFullName(profile?.full_name ?? "");
      setLoading(false);
    }

    void load();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setRole(null);
    setFullName("");
    router.replace("/login");
  }

  const workspaceHref = role === "admin" ? "/admin/dashboard" : "/employee";
  const workspaceLabel = role === "admin" ? "Відкрити панель адміністратора" : "Відкрити мій кабінет";

  return (
    <main className="page-shell overview-shell">
      <header className="overview-header">
        <div className="marketing-brand">
          <span className="brand-badge">SoftFlySystem</span>
          <span className="brand-status">Робочий простір</span>
        </div>

        <div className="overview-header-actions">
          {isAuthenticated ? (
            <>
              <Link href={workspaceHref} className="button button-secondary">
                Перейти в систему
              </Link>
              <button type="button" className="button button-primary" onClick={handleLogout}>
                Вийти
              </button>
            </>
          ) : (
            <Link href="/login" className="button button-primary">
              Увійти
            </Link>
          )}
        </div>
      </header>

      <section className="overview-hero">
        <article className="hero-copy overview-main-card">
          <p className="eyebrow">Overview</p>
          <h1>{loading ? "Завантажуємо..." : isAuthenticated ? `Привіт${fullName ? `, ${fullName}` : ""}` : "Увійдіть у систему"}</h1>
          <p className="lead compact-lead">
            {isAuthenticated
              ? "Тут лише найважливіше: відкрий свій кабінет, перевір зміни, години та виплати."
              : "Це стартова сторінка для працівника й адміністратора. Щоб перейти до роботи, просто увійдіть у систему."}
          </p>

          <div className="hero-actions">
            {isAuthenticated ? (
              <>
                <Link href={workspaceHref} className="button button-primary">
                  {workspaceLabel}
                </Link>
                <button type="button" className="button button-secondary" onClick={handleLogout}>
                  Вийти з акаунта
                </button>
              </>
            ) : (
              <Link href="/login" className="button button-primary">
                Перейти до входу
              </Link>
            )}
          </div>
        </article>

        <article className="summary-card overview-summary-card">
          <span>Що робити далі</span>
          <strong>1 дія</strong>
          <span>Натисни головну кнопку</span>
          <strong>{isAuthenticated ? "І працюй далі" : "І увійди в систему"}</strong>
          <span>{isAuthenticated ? "Вихід завжди зверху праворуч" : "Після входу відкриється твій робочий простір"}</span>
        </article>
      </section>

      <section className="overview-guides">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Для працівника</p>
              <h2>Коротка інструкція</h2>
            </div>
          </div>
          <div className="schedule-table">
            <div className="table-row stack">
              <strong>1. Відкрий свій кабінет</strong>
              <span>Там видно графік, відпрацьовані години, виплати і статус дисципліни.</span>
            </div>
            <div className="table-row stack">
              <strong>2. Перевір зміни та виплати</strong>
              <span>Подивись, які години вже враховані у виплатах, а які ще очікують нарахування.</span>
            </div>
            <div className="table-row stack">
              <strong>3. Якщо щось не так</strong>
              <span>Звернись до адміністратора, щоб він перевірив зміну, виплату або налаштування доступу.</span>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Доступ</p>
              <h2>Що доступно в системі</h2>
            </div>
          </div>
          <div className="schedule-table">
            <div className="table-row stack">
              <strong>Працівник</strong>
              <span>Графік, зміни, години, виплати, дисципліна.</span>
            </div>
            <div className="table-row stack">
              <strong>Адміністратор</strong>
              <span>Працівники, зміни, зарплата, аналітика, налаштування та термінали.</span>
            </div>
            <div className="table-row stack">
              <strong>Вихід із системи</strong>
              <span>Кнопка «Вийти» завжди доступна зверху праворуч на цій сторінці.</span>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
