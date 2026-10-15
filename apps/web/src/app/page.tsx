import { Suspense } from "react";
import { SimpleView } from "@/components/simple/SimpleView";

export default function Page() {
  return (
    <Suspense>
      <SimpleView />
    </Suspense>
  );
}
