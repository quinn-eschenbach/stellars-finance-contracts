import { Link } from "@tanstack/react-router";
import { useWallet } from "@/wallet/WalletProvider";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/utils";

type NavItem =
  | { kind: "static"; to: "/markets" | "/vault" | "/leaderboard" | "/faucet"; label: string }
  | { kind: "positions"; label: string };

const NAV: ReadonlyArray<NavItem> = [
  { kind: "static", to: "/markets", label: "Markets" },
  { kind: "static", to: "/leaderboard", label: "Leaderboard" },
  { kind: "positions", label: "Positions" },
  { kind: "static", to: "/vault", label: "Vault" },
  { kind: "static", to: "/faucet", label: "Faucet" },
];

const NAV_LINK_CLASS = `
  rounded-full px-3.5 py-1.5 text-[13px] font-medium
  text-muted-foreground transition-all duration-200
  hover:bg-foreground/[0.06] hover:text-foreground
  data-[status=active]:bg-foreground
  data-[status=active]:text-background
  data-[status=active]:shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset,0_4px_14px_-6px_rgba(0,0,0,0.5)]
  data-[status=active]:hover:bg-foreground
  data-[status=active]:hover:text-background
`;

export function Header() {
  const { status, connect, refreshing } = useWallet();
  const connectedAddress = status.kind === "ok" ? status.address : null;

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
          {NAV.map((item) => {
            if (item.kind === "positions") {
              // Positions link is parameterised on the connected wallet
              // address. Skip when nothing is connected — the page can only
              // be reached via a Leaderboard row in that case.
              if (!connectedAddress) return null;
              return (
                <Link
                  key="positions"
                  to="/positions/$address"
                  params={{ address: connectedAddress }}
                  className={NAV_LINK_CLASS}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <Link key={item.to} to={item.to} className={NAV_LINK_CLASS}>
                {item.label}
              </Link>
            );
          })}
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
            Connect Wallet
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
