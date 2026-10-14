import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: "ECHOSPACE — RF spatial sensing lab",
  description: "Ambient RF-to-3D spatial imaging research platform. Synthetic simulation, signal processing and reconstruction with explicit uncertainty.",
};

export const viewport: Viewport = { themeColor: "#080b12", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:px-2 focus:py-1">
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
