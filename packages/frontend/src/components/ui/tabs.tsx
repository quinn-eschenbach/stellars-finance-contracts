import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  onChange: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const value = controlled ?? internal;
  const onChange = (v: string) => {
    if (controlled === undefined) setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  const ctx = useContext(TabsContext);
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number; height: number; top: number } | null>(null);
  const [hasAnimated, setHasAnimated] = useState(false);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list || !ctx) return;
    const active = list.querySelector<HTMLElement>(`[data-tab-value="${CSS.escape(ctx.value)}"]`);
    if (!active) {
      setIndicator(null);
      return;
    }
    setIndicator({
      left: active.offsetLeft,
      top: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    });
  }, [ctx]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (!listRef.current) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(listRef.current);
    listRef.current.querySelectorAll<HTMLElement>("[data-tab-value]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [measure, ctx?.value]);

  // After the very first measurement we enable the slide transition. This
  // prevents the indicator from animating in from (0,0) on initial mount.
  useEffect(() => {
    if (indicator && !hasAnimated) {
      const id = requestAnimationFrame(() => setHasAnimated(true));
      return () => cancelAnimationFrame(id);
    }
  }, [indicator, hasAnimated]);

  return (
    <div
      ref={listRef}
      className={cn(
        "relative inline-flex h-10 items-center justify-center rounded-full border border-border/50 bg-card/40 p-1 text-muted-foreground backdrop-blur-md",
        className,
      )}
    >
      {indicator && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-0 rounded-full bg-foreground/95 shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset,0_4px_14px_-6px_rgba(0,0,0,0.6)]",
            hasAnimated && "transition-[left,width,top,height] duration-300 ease-[cubic-bezier(0.32,0.72,0.2,1)]",
          )}
          style={{
            left: indicator.left,
            top: indicator.top,
            width: indicator.width,
            height: indicator.height,
          }}
        />
      )}
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger must be used inside Tabs");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      data-tab-value={value}
      data-active={active || undefined}
      onClick={() => ctx.onChange(value)}
      className={cn(
        "relative z-10 inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium tracking-tight transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "text-background" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent must be used inside Tabs");
  if (ctx.value !== value) return null;
  return <div className={cn("mt-4 animate-fade-up", className)}>{children}</div>;
}
