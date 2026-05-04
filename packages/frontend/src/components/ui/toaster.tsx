import { Toaster as SonnerToaster } from "sonner";

/**
 * App-wide toast renderer. Mounted once at the root. Sonner ships its own
 * dark theme; we layer the warm border/surface tokens through CSS variables
 * (see `sonner-overrides` in index.css) instead of class overrides so the
 * library's animation/timing logic stays untouched.
 */
export function Toaster() {
  return (
    <SonnerToaster theme="dark" position="bottom-right" offset={20} richColors closeButton />
  );
}
