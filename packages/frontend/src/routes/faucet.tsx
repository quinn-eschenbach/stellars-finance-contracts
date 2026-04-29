import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAddress, useWallet } from "@/wallet/WalletProvider";
import { mockToken } from "@/contracts/clients";
import { signAndSendWithWallet } from "@/contracts/sender";
import { formatUsdc, parseUsdc } from "@/lib/utils";
import { MOCK_TOKEN_CONTRACT } from "@/lib/constants";

export const Route = createFileRoute("/faucet")({
  component: FaucetPage,
});

function FaucetPage() {
  const address = useAddress();
  const { signTransaction } = useWallet();
  const [amount, setAmount] = useState("1000");

  // Read-only: query mock-token balance for the connected address. The
  // binding's `balance` method is a view fn — simulating it gives us the
  // result without sending a tx. Refetch on success of mint mutation.
  const balance = useQuery({
    queryKey: ["mockToken", "balance", address],
    queryFn: async () => {
      if (!address) return 0n;
      const tx = await mockToken(address).balance({ account: address });
      return BigInt(tx.result?.toString() ?? "0");
    },
    enabled: !!address,
    refetchInterval: 5_000,
  });

  const mint = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      const scaled = parseUsdc(amount);
      const tx = await mockToken(address).mint({ to: address, amount: scaled });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
    },
    onSuccess: () => balance.refetch(),
  });

  if (!MOCK_TOKEN_CONTRACT) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Faucet unavailable</CardTitle>
          <CardDescription>
            VITE_MOCK_TOKEN_CONTRACT is not set. Check your .env / addresses.json.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Test USDC faucet</h1>
        <p className="text-sm text-muted-foreground">
          Mint mock USDC to your wallet to trade on the local / testnet protocol. Free, unlimited
          on this network.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!address ? (
            <p className="text-sm text-muted-foreground">Connect your Freighter wallet to continue.</p>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm font-mono">
                <span className="text-muted-foreground">Current balance</span>
                <span>${balance.data ? formatUsdc(balance.data) : "—"}</span>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Amount (USDC)</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1000"
                />
              </div>
              <Button
                onClick={() => mint.mutate()}
                disabled={mint.isPending || !amount}
                className="w-full"
              >
                {mint.isPending ? "Minting…" : `Mint ${amount} USDC`}
              </Button>
              {mint.isSuccess && (
                <p className="text-xs font-mono text-bull">tx ok: {mint.data?.slice(0, 12)}…</p>
              )}
              {mint.error && (
                <p className="text-xs text-destructive">{(mint.error as Error).message}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
