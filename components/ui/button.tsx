import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Pill buttons. One filled primary per view - the near-black "anchor" pill
// (v2 skin; inverts to off-white in dark); everything else is a soft grey
// fill (secondary), a white chip (outline, for buttons sitting on the grey
// page/header) or text-only (ghost). `accent` = the green brand fill for the
// rare call to action that should read as "go".
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-[background-color,color,box-shadow,opacity,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-anchor text-anchor-foreground shadow-sm hover:bg-anchor/85 active:bg-anchor/80",
        accent: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "bg-card text-foreground shadow-card hover:bg-muted dark:bg-secondary dark:hover:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
        link: "text-primary underline-offset-4 hover:underline",
        // 2026 pastel: the lime "go" pill (#1D2A12 on lime, 9.6:1) and the
        // translucent ink chip (secondary actions on glass / the sky).
        lime: "bg-lime text-lime-foreground shadow-lime-glow hover:shadow-[0_14px_40px_-8px_var(--lime-glow)]",
        chip: "bg-chip text-foreground hover:bg-[var(--chip-hover)]",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-9 px-3.5",
        lg: "h-12 px-7 text-[15px]",
        icon: "h-9 w-9",
        // 2026: 44px touch targets (header pills, icon buttons).
        pill: "h-11 px-[18px] text-[15px] active:scale-95 motion-reduce:active:scale-100",
        "icon-lg": "h-11 w-11 active:scale-95 motion-reduce:active:scale-100 [&_svg]:size-[18px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
