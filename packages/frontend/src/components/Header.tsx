import { Link } from "@tanstack/react-router";
import { useWallet } from "@/wallet/WalletProvider";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/utils";

const NAV: ReadonlyArray<{ to: "/markets" | "/portfolio" | "/vault" | "/faucet"; label: string }> = [
  { to: "/markets", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/vault", label: "Vault" },
  { to: "/faucet", label: "Faucet" },
];

export function Header() {
  const { status, connect, refreshing } = useWallet();

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/40 backdrop-blur-xl">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-ember/30 to-transparent" />
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link to="/" className="group flex items-center gap-2.5">
          <Logo />
          <span className="text-base font-medium tracking-tight">
            <span className="text-foreground">Stellars</span>
            <span className="ml-1.5 font-display italic text-muted-foreground">finance</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-0.5 rounded-full border border-border/40 bg-card/30 p-1 backdrop-blur-md md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{
                className:
                  "rounded-full px-3.5 py-1.5 text-[13px] font-medium bg-foreground text-background",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {status.kind === "ok" ? (
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-border/40 bg-card/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-md sm:inline-flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ember-pulse rounded-full bg-bull/80" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-bull" />
              </span>
              {status.network}
            </span>
            <span className="rounded-full border border-border/40 bg-card/40 px-3.5 py-1.5 font-mono text-xs text-foreground/90 backdrop-blur-md">
              {shortAddress(status.address)}
            </span>
          </div>
        ) : (
          <Button onClick={connect} disabled={refreshing} variant="primary" size="sm">
            {status.kind === "missing" ? "Install Freighter" : "Connect Wallet"}
          </Button>
        )}
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="relative inline-block h-7 w-7 overflow-hidden rounded-full"
      style={{
        background:
          "conic-gradient(from 200deg at 50% 50%, hsl(24 75% 55%), hsl(140 25% 45%), hsl(248 50% 45%), hsl(24 75% 55%))",
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 -3px 6px -2px rgba(0,0,0,0.5), 0 0 18px -4px hsl(24 70% 55% / 0.6)",
      }}
    >
      <span className="absolute inset-[3px] rounded-full bg-background/80" />
      <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-ember to-[hsl(28_70%_45%)]" />
    </span>
  );
}
