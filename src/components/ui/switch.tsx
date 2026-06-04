import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, id, ...props }, ref) => (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 select-none">
      <div className="relative">
        <input ref={ref} id={id} type="checkbox" className="sr-only peer" {...props} />
        <div
          className={cn(
            "h-5 w-9 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
            className
          )}
        />
        <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </div>
      {label && <span className="text-sm">{label}</span>}
    </label>
  )
);
Switch.displayName = "Switch";
