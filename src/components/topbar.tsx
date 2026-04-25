"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TopbarProps = {
  title: string;
  subtitle: string;
  homeHref: string;
  links?: Array<{ href: string; label: string }>;
};

export function Topbar({ title, subtitle, homeHref, links = [] }: TopbarProps) {
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="topbar">
      <div className="topbar-copy">
        <p className="eyebrow">{subtitle}</p>
        <h1>{title}</h1>
        {links.length ? (
          <nav className="topbar-nav">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="topbar-nav-link">
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      <div className="topbar-actions">
        <Link href={homeHref} className="button button-secondary">
          Оновити
        </Link>
        <button type="button" className="button button-primary" onClick={handleLogout}>
          Вийти
        </button>
      </div>
    </header>
  );
}
