import { Activity, Boxes, Cpu, Database, FlaskConical, Gauge, LayoutDashboard, Radio, Settings, Orbit, BookOpen, Microscope, Clapperboard } from "lucide-react";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard, primary: false, key: "1" },
  { href: "/lab", label: "Live Spatial Lab", icon: Orbit, primary: true, key: "2" },
  { href: "/arena", label: "Simulation Arena", icon: FlaskConical, primary: true, key: "3" },
  { href: "/studio", label: "RF Signal Studio", icon: Radio, primary: true, key: "4" },
  { href: "/workbench", label: "Research Workbench", icon: Microscope, primary: false, key: "5" },
  { href: "/datasets", label: "Datasets", icon: Database, primary: false, key: "6" },
  { href: "/models", label: "Models", icon: Boxes, primary: false, key: "7" },
  { href: "/experiments", label: "Experiments", icon: Activity, primary: false, key: "8" },
  { href: "/diagnostics", label: "System Diagnostics", icon: Gauge, primary: false, key: "9" },
  { href: "/settings", label: "Settings", icon: Settings, primary: false, key: "0" },
] as const;

export const SECONDARY = [
  { href: "/hardware", label: "Hardware readiness", icon: Cpu },
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/showcase", label: "Showcase", icon: Clapperboard },
] as const;
