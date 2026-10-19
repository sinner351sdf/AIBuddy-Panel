import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "./lib/cn"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        workspace: "gap-1.5 bg-transparent p-0",
        mobile: "grid w-full grid-cols-5 gap-0 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, variant = "default", ...props }: TabsPrimitive.Tab.Props & { variant?: "default" | "mobile" }) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 shadow-none transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent ",
        "data-active:bg-background data-active:text-foreground",
        "group-data-[variant=workspace]/tabs-list:h-8 group-data-[variant=workspace]/tabs-list:border-border group-data-[variant=workspace]/tabs-list:bg-background group-data-[variant=workspace]/tabs-list:text-xs group-data-[variant=workspace]/tabs-list:hover:bg-muted group-data-[variant=workspace]/tabs-list:data-active:border-primary/40 group-data-[variant=workspace]/tabs-list:data-active:bg-muted group-data-[variant=workspace]/tabs-list:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        variant === "mobile" && "h-14 min-h-14 flex-col gap-1 rounded-none border-0 bg-transparent px-1 py-0 text-[11px] leading-[14px] text-muted-foreground hover:bg-transparent hover:text-foreground data-active:bg-transparent data-active:font-semibold data-active:text-foreground data-active:[&_[data-slot=tabs-icon]]:bg-secondary [&_svg:not([class*='size-'])]:size-[22px]",
        className
      )}
      {...props}
    />
  )
}

/** Icon highlight for the mobile navigation variant; the full tab remains the touch target. */
function TabsIcon({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="tabs-icon" className={cn("relative inline-flex h-8 w-14 shrink-0 items-center justify-center rounded-full transition-colors duration-150", className)} {...props} />
}

const tabsContentVariants = cva("outline-none", {
  variants: {
    variant: {
      default: "flex-1 text-sm",
      // Existing page roots retain their layout, typography and scroll owners.
      shell: "contents",
    },
  },
  defaultVariants: { variant: "default" },
})

function TabsContent({ className, variant, ...props }: TabsPrimitive.Panel.Props & VariantProps<typeof tabsContentVariants>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      data-variant={variant ?? "default"}
      className={cn(tabsContentVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsIcon, TabsContent, tabsListVariants }
