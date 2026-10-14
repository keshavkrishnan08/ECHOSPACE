import { Suspense } from "react";
import { WorkbenchPage } from "@/components/workbench/WorkbenchPage";

export default function Page() {
  return (
    <Suspense>
      <WorkbenchPage />
    </Suspense>
  );
}
