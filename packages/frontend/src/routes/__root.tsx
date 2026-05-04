import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Toaster } from "@/components/ui/toaster";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <Header />
      <main className="container relative z-10 flex-1 py-8 md:py-12">
        <Outlet />
      </main>
      <Footer />
      <Toaster />
    </div>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-border/30 bg-background/40 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
        <span className="font-mono">Stellars Finance · testnet</span>
        <span className="font-mono">v0.1</span>
      </div>
    </footer>
  );
}
