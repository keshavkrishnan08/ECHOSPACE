import { Suspense } from "react";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";

export default function Page() {
  return (
    <Suspense>
      <ShowcasePage />
    </Suspense>
  );
}
