"use client";
import * as S from "@radix-ui/react-slider";
import * as Sw from "@radix-ui/react-switch";
import * as Sel from "@radix-ui/react-select";
import { Check, ChevronDown, Info } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/format";
import { Tip } from "./tooltip";

export function Field({ label, value, help, children, htmlFor }: { label: string; value?: React.ReactNode; help?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs text-muted">
          {label}
          {help && (
            <Tip content={help}>
              <Info className="h-3 w-3 text-faint" aria-label={help} />
            </Tip>
          )}
        </label>
        {value !== undefined && <span className="num text-2xs text-fg">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function SliderField({ label, value, min, max, step, onChange, unit, help, format, disabled }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string; help?: string; format?: (v: number) => string; disabled?: boolean }) {
  const id = useId();
  const shown = format ? format(value) : `${Number.isInteger(step) ? value.toFixed(0) : value.toFixed(Math.max(0, -Math.floor(Math.log10(step))))}${unit ? ` ${unit}` : ""}`;
  return (
    <Field label={label} value={shown} help={help} htmlFor={id}>
      <S.Root id={id} className={cn("relative flex h-4 w-full touch-none select-none items-center", disabled && "opacity-40")} value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={(v) => onChange(v[0])} aria-label={label}>
        <S.Track className="relative h-[3px] grow rounded-full bg-line">
          <S.Range className="absolute h-full rounded-full bg-signal/70" />
        </S.Track>
        <S.Thumb aria-label={label} className="block h-3 w-3 rounded-full border border-signal bg-bg shadow focus-visible:outline-2 focus-visible:outline-signal" />
      </S.Root>
    </Field>
  );
}

export function Toggle({ label, checked, onChange, help, disabled, color }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string; disabled?: boolean; color?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className={cn("flex items-center gap-1.5 text-xs", disabled ? "text-faint" : "text-muted")}>
        {color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />}
        {label}
        {help && (
          <Tip content={help}>
            <Info className="h-3 w-3 text-faint" />
          </Tip>
        )}
      </label>
      <Sw.Root id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="relative h-4 w-7 shrink-0 rounded-full border border-line bg-panel transition-colors data-[state=checked]:border-signal/60 data-[state=checked]:bg-signal/30 disabled:opacity-40">
        <Sw.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[13px] data-[state=checked]:bg-signal" />
      </Sw.Root>
    </div>
  );
}

export function SelectField({ label, value, options, onChange, help, disabled }: { label?: string; value: string; options: Array<{ value: string; label: string; disabled?: boolean }>; onChange: (v: string) => void; help?: string; disabled?: boolean }) {
  const control = (
    <Sel.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Sel.Trigger aria-label={label} className="flex h-7 w-full items-center justify-between gap-2 rounded-[5px] border border-line bg-panel px-2 text-xs text-fg hover:border-faint disabled:opacity-40">
        <Sel.Value />
        <Sel.Icon>
          <ChevronDown className="h-3 w-3 text-muted" />
        </Sel.Icon>
      </Sel.Trigger>
      <Sel.Portal>
        <Sel.Content position="popper" sideOffset={4} className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-panel-2 shadow-xl">
          <Sel.Viewport className="p-1">
            {options.map((o) => (
              <Sel.Item key={o.value} value={o.value} disabled={o.disabled} className="relative flex h-7 cursor-pointer select-none items-center rounded px-2 pl-6 text-xs text-fg outline-none data-[disabled]:text-faint data-[highlighted]:bg-signal/15">
                <Sel.ItemIndicator className="absolute left-1.5">
                  <Check className="h-3 w-3 text-signal" />
                </Sel.ItemIndicator>
                <Sel.ItemText>{o.label}</Sel.ItemText>
              </Sel.Item>
            ))}
          </Sel.Viewport>
        </Sel.Content>
      </Sel.Portal>
    </Sel.Root>
  );
  return label ? <Field label={label} help={help}>{control}</Field> : control;
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm", ariaLabel }: { value: T; options: Array<{ value: T; label: React.ReactNode; title?: string }>; onChange: (v: T) => void; size?: "sm" | "md"; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-[5px] border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn("rounded-[3px] px-2 text-2xs font-medium transition-colors", size === "sm" ? "h-5" : "h-6", o.value === value ? "bg-signal/20 text-signal" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberInput({ value, onChange, step = 0.1, min, max, label, unit }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label: string; unit?: string }) {
  return (
    <label className="flex items-center gap-1 text-2xs text-muted">
      <span className="w-3">{label}</span>
      <input
        type="number"
        aria-label={label}
        className="num h-6 w-full min-w-0 rounded border border-line bg-panel px-1.5 text-2xs text-fg"
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
        }}
      />
      {unit && <span>{unit}</span>}
    </label>
  );
}
