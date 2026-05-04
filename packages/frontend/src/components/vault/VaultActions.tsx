import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAddress, useWallet } from "@/wallet/WalletProvider";
import { mockToken, vault } from "@/contracts/clients";
import { signAndSendWithWallet } from "@/contracts/sender";
import { parseUsdc } from "@/lib/utils";
import { queryKeys } from "@/api/hooks";

/**
 * Deposit + withdraw forms for the vault. Both use the OZ FungibleVault
 * methods; deposit pulls USDC from the user's wallet via Soroban auth
 * propagation (no separate approve step needed — Freighter signs the
 * outer tx and the inner token.transfer auth comes along).
 */
export function VaultActions() {
  const address = useAddress();
  const { signTransaction } = useWallet();
  const qc = useQueryClient();

  // USDC + share balances. Not wired to SSE; refetch on tx success.
  const usdcBalance = useQuery({
    queryKey: ["mockToken", "balance", address],
    queryFn: async () => {
      if (!address) return 0n;
      const tx = await mockToken(address).balance({ account: address });
      return BigInt(tx.result?.toString() ?? "0");
    },
    enabled: !!address,
    refetchInterval: 10_000,
  });

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

  const deposit = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      const assets = parseUsdc(depositAmt);
      if (assets <= 0n) throw new Error("enter a positive amount");
      const tx = await vault(address).deposit({
        assets,
        receiver: address,
        from: address,
        operator: address,
      });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
    },
    onSuccess: () => {
      usdcBalance.refetch();
      qc.invalidateQueries({ queryKey: queryKeys.vault });
      setDepositAmt("");
    },
  });

  const withdraw = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect wallet first");
      const assets = parseUsdc(withdrawAmt);
      if (assets <= 0n) throw new Error("enter a positive amount");
      const tx = await vault(address).withdraw({
        assets,
        receiver: address,
        owner: address,
        operator: address,
      });
      const result = await signAndSendWithWallet(tx, signTransaction);
      return result.hash;
    },
    onSuccess: () => {
      usdcBalance.refetch();
      qc.invalidateQueries({ queryKey: queryKeys.vault });
      setWithdrawAmt("");
    },
  });

  if (!address) {
    return <p className="text-sm text-muted-foreground">Connect a wallet to deposit / withdraw.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm font-mono">
        <span className="text-muted-foreground">Wallet USDC</span>
        <span>{usdcBalance.data != null ? <NumberFlowUsd value={usdcBalance.data} /> : "—"}</span>
      </div>

      <Tabs defaultValue="deposit">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-3">
          <Label>Amount (USDC)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={depositAmt}
            onChange={(e) => setDepositAmt(e.target.value)}
            placeholder="0.00"
          />
          <Button
            className="w-full"
            disabled={deposit.isPending || !depositAmt}
            onClick={() => deposit.mutate()}
          >
            {deposit.isPending ? "Submitting…" : "Deposit"}
          </Button>
          {deposit.isSuccess && (
            <p className="text-xs font-mono text-bull">deposited ✓ tx {deposit.data?.slice(0, 12)}…</p>
          )}
          {deposit.error && (
            <p className="text-xs text-destructive">{(deposit.error as Error).message?.slice(0, 200)}</p>
          )}
        </TabsContent>

        <TabsContent value="withdraw" className="space-y-3">
          <Label>Amount (USDC)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={withdrawAmt}
            onChange={(e) => setWithdrawAmt(e.target.value)}
            placeholder="0.00"
          />
          <Button
            className="w-full"
            disabled={withdraw.isPending || !withdrawAmt}
            onClick={() => withdraw.mutate()}
          >
            {withdraw.isPending ? "Submitting…" : "Withdraw"}
          </Button>
          {withdraw.isSuccess && (
            <p className="text-xs font-mono text-bull">withdrew ✓ tx {withdraw.data?.slice(0, 12)}…</p>
          )}
          {withdraw.error && (
            <p className="text-xs text-destructive">{(withdraw.error as Error).message?.slice(0, 200)}</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
