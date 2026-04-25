"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabase";

type RoundingMode = "none" | "nearest" | "up" | "down";
type BreakType = "paid" | "unpaid";

type CompanySettingsPayload = {
  settings: {
    minimumShiftMinutes: number;
    maximumShiftMinutes: number;
    timeRoundingMode: RoundingMode;
    timeRoundingStepMinutes: number;
    notifyOnLongDay: boolean;
    notifyDailyHoursThreshold: number;
    notifyOnLongWeek: boolean;
    notifyWeeklyHoursThreshold: number;
    salaryRoundingMode: RoundingMode;
    salaryRoundingStep: number;
    nightShiftEnabled: boolean;
    nightShiftStart: string;
    nightShiftEnd: string;
    nightShiftMultiplier: number;
    maxBonusAdjustmentAmount: number;
    maxDeductionAdjustmentAmount: number;
  };
  breakPolicies: Array<{
    id?: string;
    title: string;
    breakType: BreakType;
    durationMinutes: number;
    autoApply: boolean;
    isRequired: boolean;
    deductFromPayroll: boolean;
    triggerAfterMinutes: number | null;
    sortOrder: number;
    isActive: boolean;
  }>;
  terminals: Array<{
    id: string;
    deviceName: string;
    deviceCode: string;
    locationLabel: string;
    isActive: boolean;
  }>;
};

const fallbackSettings: CompanySettingsPayload["settings"] = {
  minimumShiftMinutes: 60,
  maximumShiftMinutes: 960,
  timeRoundingMode: "nearest",
  timeRoundingStepMinutes: 15,
  notifyOnLongDay: true,
  notifyDailyHoursThreshold: 10,
  notifyOnLongWeek: true,
  notifyWeeklyHoursThreshold: 50,
  salaryRoundingMode: "nearest",
  salaryRoundingStep: 1,
  nightShiftEnabled: false,
  nightShiftStart: "22:00",
  nightShiftEnd: "06:00",
  nightShiftMultiplier: 1.2,
  maxBonusAdjustmentAmount: 10000,
  maxDeductionAdjustmentAmount: 10000,
};

async function callAdminJson<T>(path: string, options?: { method?: "GET" | "POST" | "PUT"; body?: unknown }) {
  const token = await getAccessToken();
  if (!token) return { ok: false as const, error: "Немає сесії адміністратора." };

  const response = await fetch(path, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.method && options.method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    ...(options?.method && options.method !== "GET" ? { body: JSON.stringify(options.body ?? {}) } : {}),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) return { ok: false as const, error: payload.error ?? "Request failed." };
  return { ok: true as const, data: payload };
}

export function SettingsAdminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState(fallbackSettings);
  const [breakPolicies, setBreakPolicies] = useState<CompanySettingsPayload["breakPolicies"]>([]);
  const [terminals, setTerminals] = useState<CompanySettingsPayload["terminals"]>([]);
  const [terminalForm, setTerminalForm] = useState({
    deviceName: "",
    deviceCode: "",
    secretKey: "",
    locationLabel: "",
  });

  async function load() {
    setLoading(true);
    const result = await callAdminJson<CompanySettingsPayload>("/api/admin/settings/company");
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося завантажити налаштування.");
    } else {
      setMessage(null);
      setSettings(result.data.settings);
      setBreakPolicies(result.data.breakPolicies);
      setTerminals(result.data.terminals);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function savePolicies() {
    setSaving(true);
    const result = await callAdminJson<{ message: string }>("/api/admin/settings/company", {
      method: "PUT",
      body: { settings, breakPolicies },
    });
    setSaving(false);
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося зберегти налаштування.");
      return;
    }
    setMessage(result.data.message ?? "Налаштування збережено.");
    await load();
  }

  async function createTerminal() {
    if (!terminalForm.deviceName || !terminalForm.deviceCode || !terminalForm.secretKey) {
      setMessage("Заповни назву, device code та secret key.");
      return;
    }

    const result = await callAdminJson<{ message: string }>("/api/admin/terminals", {
      method: "POST",
      body: terminalForm,
    });
    if (!result.ok) {
      setMessage(result.error ?? "Не вдалося створити trusted terminal.");
      return;
    }
    setTerminalForm({ deviceName: "", deviceCode: "", secretKey: "", locationLabel: "" });
    setMessage(result.data.message ?? "Trusted terminal створено.");
    await load();
  }

  function updateBreak(index: number, patch: Partial<CompanySettingsPayload["breakPolicies"][number]>) {
    setBreakPolicies((current) =>
      current.map((policy, policyIndex) => (policyIndex === index ? { ...policy, ...patch } : policy))
    );
  }

  function addBreakPolicy() {
    setBreakPolicies((current) => [
      ...current,
      {
        title: `Перерва ${current.length + 1}`,
        breakType: "unpaid",
        durationMinutes: 30,
        autoApply: false,
        isRequired: false,
        deductFromPayroll: true,
        triggerAfterMinutes: null,
        sortOrder: current.length,
        isActive: true,
      },
    ]);
  }

  function removeBreakPolicy(index: number) {
    setBreakPolicies((current) => current.filter((_, policyIndex) => policyIndex !== index).map((policy, i) => ({ ...policy, sortOrder: i })));
  }

  return (
    <section className="payroll-shell settings-shell">
      <div className="payroll-hero">
        <div>
          <p className="eyebrow">Налаштування</p>
          <h1>Політики компанії</h1>
          <p className="muted-copy">
            Усі бізнес-правила в одному місці: зміни, округлення, перерви, нічні коефіцієнти, сповіщення і trusted terminals.
          </p>
        </div>

        <div className="payroll-actions">
          <button type="button" className="button button-primary" onClick={savePolicies} disabled={saving}>
            {saving ? "Зберігаємо..." : "Зберегти політики"}
          </button>
        </div>
      </div>

      {message ? <section className="panel notice-panel">{message}</section> : null}
      {loading ? <section className="panel">Завантажуємо налаштування...</section> : null}

      {!loading ? (
        <>
          <section className="settings-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Shift policy</p>
                  <h2>Правила зміни</h2>
                </div>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Мінімальна тривалість зміни (хв)</span>
                  <input type="number" min="0" value={settings.minimumShiftMinutes} onChange={(e) => setSettings((current) => ({ ...current, minimumShiftMinutes: Number(e.target.value) }))} />
                </label>
                <label className="field">
                  <span>Максимальна тривалість зміни (хв)</span>
                  <input type="number" min="0" value={settings.maximumShiftMinutes} onChange={(e) => setSettings((current) => ({ ...current, maximumShiftMinutes: Number(e.target.value) }))} />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Округлення годин</span>
                  <select value={settings.timeRoundingMode} onChange={(e) => setSettings((current) => ({ ...current, timeRoundingMode: e.target.value as RoundingMode }))}>
                    <option value="none">Без округлення</option>
                    <option value="nearest">До найближчого</option>
                    <option value="up">В більшу сторону</option>
                    <option value="down">В меншу сторону</option>
                  </select>
                </label>
                <label className="field">
                  <span>Крок округлення (хв)</span>
                  <input type="number" min="1" value={settings.timeRoundingStepMinutes} onChange={(e) => setSettings((current) => ({ ...current, timeRoundingStepMinutes: Number(e.target.value) }))} />
                </label>
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Alerts</p>
                  <h2>Сповіщення про перевищення</h2>
                </div>
              </div>

              <div className="settings-check-grid">
                <label className="checkbox-row">
                  <span>Попереджати про занадто багато годин за день</span>
                  <input type="checkbox" checked={settings.notifyOnLongDay} onChange={(e) => setSettings((current) => ({ ...current, notifyOnLongDay: e.target.checked }))} />
                </label>
                <label className="field">
                  <span>Поріг на день (год)</span>
                  <input type="number" min="0" step="0.5" value={settings.notifyDailyHoursThreshold} onChange={(e) => setSettings((current) => ({ ...current, notifyDailyHoursThreshold: Number(e.target.value) }))} />
                </label>
                <label className="checkbox-row">
                  <span>Попереджати про занадто багато годин за тиждень</span>
                  <input type="checkbox" checked={settings.notifyOnLongWeek} onChange={(e) => setSettings((current) => ({ ...current, notifyOnLongWeek: e.target.checked }))} />
                </label>
                <label className="field">
                  <span>Поріг на тиждень (год)</span>
                  <input type="number" min="0" step="0.5" value={settings.notifyWeeklyHoursThreshold} onChange={(e) => setSettings((current) => ({ ...current, notifyWeeklyHoursThreshold: Number(e.target.value) }))} />
                </label>
              </div>
            </article>
          </section>

          <section className="settings-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Breaks</p>
                  <h2>Політики перерв</h2>
                </div>
                <button type="button" className="button button-secondary" onClick={addBreakPolicy}>
                  Додати перерву
                </button>
              </div>

              <div className="settings-stack">
                {breakPolicies.map((policy, index) => (
                  <div key={policy.id ?? `new-${index}`} className="editor-card">
                    <div className="panel-head">
                      <div>
                        <p className="eyebrow">Перерва {index + 1}</p>
                        <h2>{policy.title || "Нова перерва"}</h2>
                      </div>
                      <button type="button" className="button button-danger button-compact" onClick={() => removeBreakPolicy(index)}>
                        Видалити
                      </button>
                    </div>

                    <div className="field-row">
                      <label className="field">
                        <span>Назва</span>
                        <input value={policy.title} onChange={(e) => updateBreak(index, { title: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Тип</span>
                        <select value={policy.breakType} onChange={(e) => updateBreak(index, { breakType: e.target.value as BreakType })}>
                          <option value="unpaid">Неоплачувана</option>
                          <option value="paid">Оплачувана</option>
                        </select>
                      </label>
                    </div>

                    <div className="field-row">
                      <label className="field">
                        <span>Тривалість (хв)</span>
                        <input type="number" min="1" value={policy.durationMinutes} onChange={(e) => updateBreak(index, { durationMinutes: Number(e.target.value) })} />
                      </label>
                      <label className="field">
                        <span>Автозастосування після (хв)</span>
                        <input
                          type="number"
                          min="0"
                          placeholder="Напр. 240"
                          value={policy.triggerAfterMinutes ?? ""}
                          onChange={(e) => updateBreak(index, { triggerAfterMinutes: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                    </div>

                    <div className="settings-check-grid">
                      <label className="checkbox-row">
                        <span>Автоматично застосовувати</span>
                        <input type="checkbox" checked={policy.autoApply} onChange={(e) => updateBreak(index, { autoApply: e.target.checked })} />
                      </label>
                      <label className="checkbox-row">
                        <span>Обов'язкова перерва</span>
                        <input type="checkbox" checked={policy.isRequired} onChange={(e) => updateBreak(index, { isRequired: e.target.checked })} />
                      </label>
                      <label className="checkbox-row">
                        <span>Впливає на payroll</span>
                        <input type="checkbox" checked={policy.deductFromPayroll} onChange={(e) => updateBreak(index, { deductFromPayroll: e.target.checked })} />
                      </label>
                      <label className="checkbox-row">
                        <span>Активна політика</span>
                        <input type="checkbox" checked={policy.isActive} onChange={(e) => updateBreak(index, { isActive: e.target.checked })} />
                      </label>
                    </div>
                  </div>
                ))}

                {!breakPolicies.length ? <div className="hint-text">Політики перерв ще не створені.</div> : null}
              </div>
            </article>
          </section>

          <section className="settings-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Payroll rules</p>
                  <h2>Правила зарплати</h2>
                </div>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Округлення зарплати</span>
                  <select value={settings.salaryRoundingMode} onChange={(e) => setSettings((current) => ({ ...current, salaryRoundingMode: e.target.value as RoundingMode }))}>
                    <option value="none">Без округлення</option>
                    <option value="nearest">До найближчого</option>
                    <option value="up">В більшу сторону</option>
                    <option value="down">В меншу сторону</option>
                  </select>
                </label>
                <label className="field">
                  <span>Крок округлення зарплати</span>
                  <input type="number" min="0" step="0.01" value={settings.salaryRoundingStep} onChange={(e) => setSettings((current) => ({ ...current, salaryRoundingStep: Number(e.target.value) }))} />
                </label>
              </div>

              <div className="field-row">
                <label className="checkbox-row">
                  <span>Увімкнути нічні зміни</span>
                  <input type="checkbox" checked={settings.nightShiftEnabled} onChange={(e) => setSettings((current) => ({ ...current, nightShiftEnabled: e.target.checked }))} />
                </label>
                <label className="field">
                  <span>Нічний коефіцієнт</span>
                  <input type="number" min="1" step="0.01" value={settings.nightShiftMultiplier} onChange={(e) => setSettings((current) => ({ ...current, nightShiftMultiplier: Number(e.target.value) }))} />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Початок нічної зміни</span>
                  <input type="time" value={settings.nightShiftStart} onChange={(e) => setSettings((current) => ({ ...current, nightShiftStart: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Кінець нічної зміни</span>
                  <input type="time" value={settings.nightShiftEnd} onChange={(e) => setSettings((current) => ({ ...current, nightShiftEnd: e.target.value }))} />
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Максимальний бонус вручну</span>
                  <input type="number" min="0" step="0.01" value={settings.maxBonusAdjustmentAmount} onChange={(e) => setSettings((current) => ({ ...current, maxBonusAdjustmentAmount: Number(e.target.value) }))} />
                </label>
                <label className="field">
                  <span>Максимальний штраф вручну</span>
                  <input type="number" min="0" step="0.01" value={settings.maxDeductionAdjustmentAmount} onChange={(e) => setSettings((current) => ({ ...current, maxDeductionAdjustmentAmount: Number(e.target.value) }))} />
                </label>
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Trusted terminals</p>
                  <h2>Термінали компанії</h2>
                </div>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Назва</span>
                  <input value={terminalForm.deviceName} onChange={(e) => setTerminalForm((current) => ({ ...current, deviceName: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Device code</span>
                  <input value={terminalForm.deviceCode} onChange={(e) => setTerminalForm((current) => ({ ...current, deviceCode: e.target.value }))} />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Secret key</span>
                  <input value={terminalForm.secretKey} onChange={(e) => setTerminalForm((current) => ({ ...current, secretKey: e.target.value }))} />
                </label>
                <label className="field">
                  <span>Локація</span>
                  <input value={terminalForm.locationLabel} onChange={(e) => setTerminalForm((current) => ({ ...current, locationLabel: e.target.value }))} />
                </label>
              </div>
              <button type="button" className="button button-secondary full-width" onClick={createTerminal}>
                Додати trusted terminal
              </button>

              <div className="schedule-table">
                {terminals.map((terminal) => (
                  <div key={terminal.id} className="table-row settings-terminal-row">
                    <strong>{terminal.deviceName}</strong>
                    <span>{terminal.deviceCode}</span>
                    <span>{terminal.locationLabel || "Без локації"}</span>
                    <span>{terminal.isActive ? "Активний" : "Вимкнений"}</span>
                  </div>
                ))}
                {!terminals.length ? <div className="hint-text">Trusted terminals ще не додані.</div> : null}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </section>
  );
}
