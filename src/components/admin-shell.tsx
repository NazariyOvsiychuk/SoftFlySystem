"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { Topbar } from "@/components/topbar";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/employees", label: "Працівники" },
  { href: "/admin/schedule", label: "Зміни" },
  { href: "/admin/time", label: "Час" },
  { href: "/admin/payroll", label: "Зарплата" },
  { href: "/admin/profitability", label: "Маржинальність" },
  { href: "/admin/analytics", label: "Аналітика" },
  { href: "/admin/settings", label: "Налаштування" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AuthGuard allowedRoles={["admin"]}>
      <main className="admin-shell">
        <Topbar
          title="Операційний центр"
          subtitle="Адміністратор"
          homeHref={pathname || "/admin/dashboard"}
          links={[
            { href: "/", label: "Overview" },
            { href: "/employee", label: "Employee view" },
          ]}
        />

        <div className="admin-body">
          <aside className="admin-sidebar">
            <nav className="admin-nav">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={isActive(pathname ?? "", item.href) ? "admin-nav-link active" : "admin-nav-link"}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          <section className="admin-content">{children}</section>
        </div>
      </main>
    </AuthGuard>
  );
}
