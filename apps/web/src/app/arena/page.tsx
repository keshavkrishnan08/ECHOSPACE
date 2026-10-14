import { Suspense } from "react";
import { ArenaPage } from "@/components/arena/ArenaPage";

export default function Page() {
  return (
    <Suspense>
      <ArenaPage />
    </Suspense>
  );
}
