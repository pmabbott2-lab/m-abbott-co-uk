import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

class HubPanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-2">
          <p className="font-medium">This section failed to load</p>
          <p className="text-xs font-mono text-muted-foreground break-all">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const TabsVariantContext = React.createContext<"default" | "hub" | "hubSub">("default");

const Tabs = TabsPrimitive.Root;

const tabsListClass: Record<"default" | "hub" | "hubSub", string> = {
  default: "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
  hub:
    "flex flex-wrap h-auto w-full max-w-4xl mx-auto mb-5 justify-center gap-1 p-1.5 rounded-xl border border-border bg-muted/50 text-muted-foreground shadow-sm",
  hubSub:
    "inline-flex flex-wrap h-auto gap-1 p-1 mb-4 rounded-lg border border-border bg-muted text-muted-foreground",
};

const tabsTriggerClass: Record<"default" | "hub" | "hubSub", string> = {
  default:
    "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
  hub:
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md",
  hubSub:
    "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
};

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: "default" | "hub" | "hubSub";
  }
>(({ className, variant = "default", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(tabsListClass[variant], className)}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabsTriggerClass[variant], className)}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

type HubSubNavTab = {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  content: React.ReactNode;
};

/** State-based sub-nav — use instead of nested Radix Tabs (avoids tab crashes). */
function HubSubNav({
  tabs,
  defaultValue,
  variant = "hubSub",
  className,
  listClassName,
}: {
  tabs: HubSubNavTab[];
  defaultValue: string;
  variant?: "hub" | "hubSub";
  className?: string;
  listClassName?: string;
}) {
  const safeDefault = tabs.some((tab) => tab.id === defaultValue) ? defaultValue : (tabs[0]?.id ?? "");
  const [active, setActive] = React.useState(safeDefault);

  const tabIds = tabs.map((tab) => tab.id).join("|");

  React.useEffect(() => {
    if (!tabIds.split("|").includes(active)) {
      setActive(safeDefault);
    }
  }, [active, safeDefault, tabIds]);

  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div className="space-y-4">{tabs[0].content}</div>;

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className={cn("space-y-4", className)}>
      <div
        className={cn(tabsListClass[variant], listClassName ?? "w-full justify-start")}
        role="tablist"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.id)}
              className={cn(
                tabsTriggerClass[variant],
                "gap-1.5",
                selected && variant === "hubSub" && "bg-card text-foreground shadow-sm",
                selected && variant === "hub" && "bg-primary text-primary-foreground shadow-md",
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="mt-0 space-y-4" role="tabpanel">
        <HubPanelErrorBoundary key={active}>{current.content}</HubPanelErrorBoundary>
      </div>
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, HubSubNav };
export type { HubSubNavTab };
