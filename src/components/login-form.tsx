"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authError, data } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setLoading(false);
      setError(authError.message);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    setLoading(false);
    router.replace(profile?.role === "admin" ? "/admin" : "/employee");
  }

  return (
    <form className="form-card" onSubmit={handleSubmit}>
      <div className="panel-head">
        <p className="eyebrow">Trusted Workspace</p>
        <h2>Вхід у систему</h2>
        <p className="hint-text">
          Доступ мають лише створені адміністратором користувачі. Всі години, зміни та виплати пов’язані з вашим профілем.
        </p>
      </div>

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@company.com"
          required
        />
      </label>

      <label className="field">
        <span>Пароль</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
          required
        />
      </label>

      {error ? <p className="error-text">{error}</p> : null}

      <button className="button button-primary full-width" type="submit" disabled={loading}>
        {loading ? "Входимо..." : "Увійти"}
      </button>

      <p className="hint-text">
        Самостійна реєстрація відключена. Якщо ви не можете увійти, зверніться до адміністратора системи.
      </p>
    </form>
  );
}
