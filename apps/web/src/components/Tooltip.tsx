import * as RTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * Thin wrapper over Radix's tooltip primitive (the same one shadcn/ui wraps),
 * styled with our own CSS tokens instead of Tailwind. Used to label icon-only
 * controls on small screens. `children` must be a single focusable element.
 */
export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RTooltip.Provider delayDuration={200} skipDelayDuration={300}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content className="tooltip" side={side} sideOffset={7}>
            {label}
            <RTooltip.Arrow className="tooltip-arrow" width={11} height={6} />
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}
