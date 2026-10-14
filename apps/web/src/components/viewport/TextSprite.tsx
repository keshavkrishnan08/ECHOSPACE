"use client";
import { useMemo } from "react";
import * as THREE from "three";

const cache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();

function texture(text: string, color: string, bg: string | null, border: string | null) {
  const key = `${text}|${color}|${bg}|${border}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const fontPx = 48;
  const pad = 14;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = `500 ${fontPx}px "JetBrains Mono Variable", ui-monospace, monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 1.4;
  c.width = w;
  c.height = h;
  ctx.font = `500 ${fontPx}px "JetBrains Mono Variable", ui-monospace, monospace`;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, 8);
    ctx.fill();
  }
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, w - 3, h - 3, 8);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const out = { tex, aspect: w / h };
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * Billboard text label backed by a cached canvas texture. Much cheaper than DOM overlays and
 * safe to create/destroy every frame.
 */
export function TextSprite({ text, position, color = "#8b9ab0", bg = "rgba(8,11,18,0.75)", border = null, height = 0.14 }: { text: string; position: [number, number, number]; color?: string; bg?: string | null; border?: string | null; height?: number }) {
  const t = useMemo(() => (typeof document === "undefined" ? null : texture(text, color, bg, border)), [text, color, bg, border]);
  if (!t) return null;
  return (
    <sprite position={position} scale={[height * t.aspect, height, 1]} renderOrder={10}>
      <spriteMaterial map={t.tex} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}
