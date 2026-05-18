import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Droplet, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddress } from "@/wallet/WalletProvider";
import { addTokenToWallet } from "@/wallet/freighter";
import { mockToken } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { parseUsdc } from "@/lib/utils";
import { MOCK_TOKEN_CONTRACT } from "@/lib/constants";
import { queryKeys, useWalletBalance } from "@/api/hooks";
import { toastSuccess, toastError } from "@/lib/toast";

export const Route = createFileRoute("/faucet")({
  component: FaucetPage,
});

const PRESETS = ["100", "1000", "10000"];

function FaucetPage() {
  const address = useAddress();
  const [amount, setAmount] = useState("1000");
  const [addingToken, setAddingToken] = useState(false);

  const balance = useWalletBalance(address);

  async function handleAddToken() {
    if (!MOCK_TOKEN_CONTRACT) return;
    setAddingToken(true);
    try {
      const result = await addTokenToWallet(MOCK_TOKEN_CONTRACT);
      if (result === "added") {
        toastSuccess("USDC added", "Your wallet is now tracking the mock USDC contract.");
      } else {
        // Non-Freighter wallets have no programmatic add-token surface, so
        // we drop the contract id on the clipboard and let the user paste
        // it into the wallet's add-asset UI.
        await navigator.clipboard.writeText(MOCK_TOKEN_CONTRACT);
        toastSuccess(
          "Contract address copied",
          "Paste it into your wallet's add-asset flow to track USDC.",
        );
      }
    } catch (err) {
      toastError(err, "Couldn't add USDC to wallet");
    } finally {
      setAddingToken(false);
    }
  }

  const mint = useTxMutation({
    action: "Mint testnet USDC",
    successDetail: `${amount} USDC minted to your wallet.`,
    invalidate: [queryKeys.walletBalance(address)],
    build: async () => {
      if (!address) throw new Error("connect wallet first");
      const scaled = parseUsdc(amount);
      return mockToken(address).mint({ to: address, amount: scaled });
    },
  });

  if (!MOCK_TOKEN_CONTRACT) {
    return (
      <div className="mx-auto max-w-lg animate-fade-up">
        <Card>
          <CardHeader>
            <CardTitle>Faucet unavailable</CardTitle>
            <CardDescription>
              VITE_MOCK_TOKEN_CONTRACT is not set. Check your .env / addresses.json.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 animate-fade-up">
      <header className="space-y-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Testnet
        </span>
        <h1 className="font-display text-5xl tracking-tightest text-foreground md:text-6xl">
          Faucet
        </h1>
        <p className="text-sm text-muted-foreground">
          Mint mock USDC to your wallet to trade on the local / testnet protocol.
          <span className="ml-1 text-foreground/80">Free, unlimited.</span>
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="grid h-10 w-10 place-items-center rounded-full border border-ember/30 bg-ember/10 text-ember">
            <Droplet className="h-4 w-4" />
          </span>
          <div>
            <CardTitle>Mint USDC</CardTitle>
            <p className="text-[11px] text-muted-foreground/80">Mock token · 7 decimals</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!address ? (
            <p className="rounded-xl border border-dashed border-border/50 bg-background/30 px-4 py-6 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Connect a Stellar wallet to continue
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/30 px-4 py-3">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Current balance
                </span>
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {balance.data != null ? <NumberFlowUsd value={balance.data} /> : "—"}
                </span>
              </div>
              <div className="space-y-2">
                <Label>Amount (USDC)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1000"
                  className="h-12 text-lg"
                />
                <div className="flex gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAmount(p)}
                      className={`flex-1 rounded-lg border px-2 py-1 font-mono text-[11px] tracking-tight transition-all ${
                        amount === p
                          ? "border-ember/60 bg-ember/10 text-foreground"
                          : "border-border/50 bg-card/30 text-muted-foreground hover:border-ember/40 hover:text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={() => mint.mutate()}
                disabled={mint.isPending || !amount}
                className="w-full"
              >
                {mint.isPending ? "Minting…" : `Mint ${amount} USDC`}
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={handleAddToken}
                disabled={addingToken}
                className="w-full gap-2"
              >
                <Plus className="h-4 w-4" />
                {addingToken ? "Adding…" : "Add USDC to wallet"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
