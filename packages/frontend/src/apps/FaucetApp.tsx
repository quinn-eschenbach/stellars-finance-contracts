import { useState } from "react";
import { Frame, GroupBox } from "react95";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WellNote } from "@/components/ui/well-note";
import { useAddress } from "@/wallet/WalletProvider";
import { addTokenToWallet } from "@/wallet/freighter";
import { mockToken } from "@/contracts/clients";
import { useTxMutation } from "@/contracts/useTxMutation";
import { NumberFlowUsd } from "@/components/ui/number-flow";
import { numberToAmount, parseUsdc } from "@/lib/utils";
import { MOCK_TOKEN_CONTRACT } from "@/lib/constants";
import { queryKeys, useWalletBalance } from "@/api/hooks";
import { toastSuccess, toastError } from "@/lib/toast";
import { LogOnPrompt } from "@/desktop/Logon";

const PRESETS = [100, 1000, 10000];

/** Testnet USDC mint window. Free, unlimited — mock token, 7 decimals. */
export function FaucetApp() {
  const address = useAddress();
  const [amount, setAmount] = useState(1000);
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
      const scaled = parseUsdc(numberToAmount(amount));
      return mockToken(address).mint({ to: address, amount: scaled });
    },
  });

  if (!MOCK_TOKEN_CONTRACT) {
    return (
      <WellNote>
        Faucet unavailable — VITE_MOCK_TOKEN_CONTRACT is not set. Check your .env /
        addresses.json.
      </WellNote>
    );
  }

  if (!address) {
    return <LogOnPrompt message="Log on with a Stellar wallet to mint testnet USDC." />;
  }

  return (
    <GroupBox label="Mint USDC" className="!pt-3">
      <div className="space-y-4">
        <Frame variant="status" className="!flex w-full items-center justify-between !px-2 !py-1">
          <span className="text-xs">Current balance</span>
          <span className="font-mono text-sm tabular-nums">
            {balance.data != null ? <NumberFlowUsd value={balance.data} /> : "—"}
          </span>
        </Frame>

        <div className="space-y-1.5">
          <Label>Amount (USDC)</Label>
          <NumberInput value={amount} onChange={setAmount} min={0} step={100} width="100%" />
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p}
                size="sm"
                active={amount === p}
                onClick={() => setAmount(p)}
                className="flex-1 font-mono"
              >
                {p}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Button
            variant="primary"
            onClick={() => mint.mutate()}
            disabled={mint.isPending || !amount}
            className="w-full"
          >
            {mint.isPending ? "Minting…" : `Mint ${amount} USDC`}
          </Button>
          <Button onClick={handleAddToken} disabled={addingToken} className="w-full">
            {addingToken ? "Adding…" : "Add USDC to wallet"}
          </Button>
        </div>
      </div>
    </GroupBox>
  );
}
