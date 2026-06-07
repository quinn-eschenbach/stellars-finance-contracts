import { createFileRoute } from "@tanstack/react-router";
import { Desktop } from "@/desktop/Desktop";

interface DesktopSearch {
  /** Comma-joined open-window ids in z-order, e.g. "trade:XLM,vault". */
  w?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): DesktopSearch => ({
    w: typeof search.w === "string" && search.w.length > 0 ? search.w : undefined,
  }),
  component: Desktop,
});
