import { Link } from "@tanstack/react-router";
import { useWallet } from "@/wallet/WalletProvider";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/utils";

export function Header() {
  const { status, connect, refreshing } = useWallet();

  return (
    <header className="border-b border-border">
      <div className="container flex h-14 items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Stellars
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link
              to="/markets"
              className="hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              Markets
            </Link>
            <Link
              to="/portfolio"
              className="hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              Portfolio
            </Link>
            <Link to="/vault" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Vault
            </Link>
            <Link to="/faucet" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Faucet
            </Link>
          </nav>
        </div>

        {status.kind === "ok" ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{status.network}</span>
            <span className="rounded-md bg-secondary px-3 py-1.5 font-mono text-xs">
              {shortAddress(status.address)}
            </span>
          </div>
        ) : (
          <Button onClick={connect} disabled={refreshing} size="sm">
            {status.kind === "missing" ? "Install Freighter" : "Connect Wallet"}
          </Button>
        )}
      </div>
    </header>
  );
}
