import { Suspense } from "react";
import { DocsPage } from "@/components/system/DocsPage";

export default function Page() {
  return (
    <Suspense>
      <DocsPage />
    </Suspense>
  );
}
