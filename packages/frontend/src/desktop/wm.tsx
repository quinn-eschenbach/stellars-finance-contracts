import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getRouteApi } from "@tanstack/react-router";

/** Every openable "program" on the desktop. */
export type AppKind = "trade" | "vault" | "faucet" | "profile" | "leaderboard";

const KINDS: ReadonlyArray<AppKind> = ["trade", "vault", "faucet", "profile", "leaderboard"];

export interface DesktopWindow {
  /** `kind` or `kind:param` — e.g. "vault", "trade:XLM", "profile:GABC…". */
  id: string;
  kind: AppKind;
  param?: string;
  minimized: boolean;
  maximized: boolean;
}

export function windowId(kind: AppKind, param?: string): string {
  return param ? `${kind}:${param}` : kind;
}

/** Parse a window id from the URL. Returns null for ids we don't recognise. */
export function parseWindowId(id: string): { kind: AppKind; param?: string } | null {
  const sep = id.indexOf(":");
  const kind = (sep === -1 ? id : id.slice(0, sep)) as AppKind;
  const param = sep === -1 ? undefined : id.slice(sep + 1);
  if (!KINDS.includes(kind)) return null;
  if (kind === "trade" && !param) return null;
  return { kind, param };
}

interface WindowManagerValue {
  /** Open windows in z-order — last entry is on top. */
  windows: DesktopWindow[];
  /** Topmost non-minimized window, or null when everything is minimized/closed. */
  focusedId: string | null;
  open: (kind: AppKind, param?: string) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  /** Win95 taskbar button semantics: restore if minimized, minimize if focused, else focus. */
  taskbarActivate: (id: string) => void;
}

const WindowManagerContext = createContext<WindowManagerValue | null>(null);

const routeApi = getRouteApi("/");

interface WindowFlags {
  minimized: boolean;
  maximized: boolean;
}

/**
 * Which windows are open (and their z-order) lives in the `?w=` search param,
 * so window sets are shareable and refresh-safe. Minimized/maximized state is
 * session-local — a fresh load restores every window un-minimized, like a
 * reboot did in 95.
 */
export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const navigate = routeApi.useNavigate();
  const { w } = routeApi.useSearch();
  const [flags, setFlags] = useState<Record<string, WindowFlags>>({});

  const ids = useMemo(
    () => (w ? w.split(",").filter((id) => parseWindowId(id) !== null) : []),
    [w],
  );

  const setIds = useCallback(
    (next: string[], replace: boolean) => {
      void navigate({
        search: (prev: { w?: string }) => ({
          ...prev,
          w: next.length > 0 ? next.join(",") : undefined,
        }),
        replace,
      });
    },
    [navigate],
  );

  const setFlag = useCallback((id: string, patch: Partial<WindowFlags>) => {
    setFlags((prev) => {
      const cur = prev[id] ?? { minimized: false, maximized: false };
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }, []);

  const focus = useCallback(
    (id: string) => {
      if (!ids.includes(id)) return;
      setFlag(id, { minimized: false });
      if (ids[ids.length - 1] !== id) {
        // Re-ordering for focus shouldn't pollute history — replace.
        setIds([...ids.filter((x) => x !== id), id], true);
      }
    },
    [ids, setIds, setFlag],
  );

  const open = useCallback(
    (kind: AppKind, param?: string) => {
      const id = windowId(kind, param);
      if (ids.includes(id)) {
        focus(id);
        return;
      }
      setFlag(id, { minimized: false });
      setIds([...ids, id], false);
    },
    [ids, focus, setIds, setFlag],
  );

  const close = useCallback(
    (id: string) => {
      setIds(ids.filter((x) => x !== id), false);
      setFlags((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    },
    [ids, setIds],
  );

  const minimize = useCallback((id: string) => setFlag(id, { minimized: true }), [setFlag]);

  const toggleMaximize = useCallback(
    (id: string) => {
      setFlags((prev) => {
        const cur = prev[id] ?? { minimized: false, maximized: false };
        return { ...prev, [id]: { ...cur, maximized: !cur.maximized } };
      });
      focus(id);
    },
    [focus],
  );

  const windows = useMemo<DesktopWindow[]>(
    () =>
      ids.map((id) => {
        const parsed = parseWindowId(id)!;
        const f = flags[id];
        return {
          id,
          kind: parsed.kind,
          param: parsed.param,
          minimized: f?.minimized ?? false,
          maximized: f?.maximized ?? false,
        };
      }),
    [ids, flags],
  );

  const focusedId = useMemo(() => {
    for (let i = windows.length - 1; i >= 0; i--) {
      if (!windows[i].minimized) return windows[i].id;
    }
    return null;
  }, [windows]);

  const taskbarActivate = useCallback(
    (id: string) => {
      const win = windows.find((x) => x.id === id);
      if (!win) return;
      if (win.minimized) {
        focus(id);
      } else if (focusedId === id) {
        minimize(id);
      } else {
        focus(id);
      }
    },
    [windows, focusedId, focus, minimize],
  );

  const value = useMemo<WindowManagerValue>(
    () => ({ windows, focusedId, open, close, focus, minimize, toggleMaximize, taskbarActivate }),
    [windows, focusedId, open, close, focus, minimize, toggleMaximize, taskbarActivate],
  );

  return <WindowManagerContext.Provider value={value}>{children}</WindowManagerContext.Provider>;
}

export function useWindowManager(): WindowManagerValue {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) throw new Error("useWindowManager must be used inside <WindowManagerProvider>");
  return ctx;
}
