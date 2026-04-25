import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SoftFlySystem",
  description: "Closed workforce operations platform for shifts, payroll visibility and trusted terminals.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
