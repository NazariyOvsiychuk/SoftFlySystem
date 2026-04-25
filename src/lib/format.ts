export function formatMoney(value: number, currency = "UAH") {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCompactMoney(value: number, currency = "UAH") {
  const amount = Number(value ?? 0);
  const abs = Math.abs(amount);

  if (abs < 100_000) {
    return formatMoney(amount, currency);
  }

  const suffix =
    currency === "UAH"
      ? "₴"
      : new Intl.NumberFormat("uk-UA", {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        })
          .formatToParts(1)
          .find((part) => part.type === "currency")
          ?.value ?? currency;

  if (abs >= 1_000_000_000) {
    return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(amount / 1_000_000_000)} млрд ${suffix}`;
  }

  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(amount / 1_000_000)} млн ${suffix}`;
  }

  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(amount / 1_000)} тис. ${suffix}`;
}

export function formatHours(minutes: number) {
  return `${(minutes / 60).toFixed(2)} год`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
