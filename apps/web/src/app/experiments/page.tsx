import { Suspense } from "react";
import { ExperimentsPage } from "@/components/experiments/ExperimentsPage";

export default function Page() {
  return (
    <Suspense>
      <ExperimentsPage />
    </Suspense>
  );
}
