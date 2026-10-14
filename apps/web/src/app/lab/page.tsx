"use client";
import { SceneViewport } from "@/components/viewport/SceneViewport";
import { useFrame } from "@/lib/engine/hooks";
import { useSession } from "@/lib/store/session";
export default function Page() {
  const frame = useFrame(30);
  const s = useSession();
  return <SceneViewport frame={frame} config={s.config} info={s.info} />;
}
