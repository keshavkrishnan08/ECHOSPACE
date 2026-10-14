"use client";
import { useEffect } from "react";
import { useUi } from "@/lib/store/ui";
import { TOUR } from "@/components/common/Tour";

export default function Page() {
  const setTour = useUi((s) => s.setTour);
  useEffect(() => {
    setTour(0);
  }, [setTour]);
  return (
    <div className="p-6 text-xs text-muted">
      Starting the guided demo “From signal to space” ({TOUR.length} acts)…
    </div>
  );
}
