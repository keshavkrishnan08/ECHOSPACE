"use client";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/format";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "border-signal/60 bg-signal/15 text-signal hover:bg-signal/25",
        default: "border-line bg-panel text-fg hover:bg-panel-2 hover:border-faint",
        ghost: "border-transparent text-muted hover:bg-panel hover:text-fg",
        danger: "border-err/50 bg-err/10 text-err hover:bg-err/20",
        active: "border-signal/50 bg-signal/10 text-fg",
      },
      size: { sm: "h-6 px-2", md: "h-7 px-2.5", lg: "h-9 px-4 text-sm", icon: "h-7 w-7 p-0", iconSm: "h-6 w-6 p-0" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...props} />;
});
