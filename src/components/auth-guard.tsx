"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type AuthGuardProps = {
  children: React.ReactNode;
  allowedRoles?: Array<"admin" | "employee">;
  allowGuest?: boolean;
};

export function AuthGuard({ children, allowedRoles, allowGuest = false }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function validate() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        if (allowGuest) {
          setReady(true);
          return;
        }

        router.replace("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!active) {
        return;
      }

      if (!profile?.role) {
        router.replace("/login");
        return;
      }

      if (allowedRoles && !allowedRoles.includes(profile.role)) {
        router.replace(profile.role === "admin" ? "/admin" : "/employee");
        return;
      }

      if (pathname === "/login") {
        router.replace(profile.role === "admin" ? "/admin" : "/employee");
        return;
      }

      setReady(true);
    }

    validate();

    return () => {
      active = false;
    };
  }, [allowGuest, allowedRoles, pathname, router]);

  if (!ready) {
    return <main className="center-shell">Перевіряємо доступ...</main>;
  }

  return <>{children}</>;
}
