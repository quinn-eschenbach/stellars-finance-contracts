import { Toaster as SonnerToaster } from "sonner";

/**
 * App-wide toast renderer. Mounted once at the root. The Win95 dialog-box
 * chrome comes from the `[data-sonner-toast]` overrides in index.css so the
 * library's animation/timing logic stays untouched.
 */
export function Toaster() {
  return <SonnerToaster theme="light" position="bottom-right" offset={20} closeButton />;
}
