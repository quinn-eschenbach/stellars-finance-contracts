import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useWallet } from "@/wallet/WalletProvider";
import { signAndSendWithWallet } from "@/contracts/sender";
import { txToast } from "@/lib/toast";

interface UseTxMutationOptions<TInput> {
  /** Verb-noun used for the toast title ("Open long", "Withdraw"). */
  action: string;
  /** Optional success-toast body — falls back to a generic confirmation. */
  successDetail?: string;
  /**
   * Build the binding's AssembledTransaction. Receives the form input the
   * call-site collected and threads it into a `client.method(args)` call.
   * The `tx` shape is opaque here — the binding's `await` chain is checked
   * at the call-site, same trade-off as ADR-0002 made for ParsedEvent data.
   */
  build: (input: TInput) => Promise<unknown>;
  /**
   * Query keys to invalidate after the tx confirms. Most call-sites want at
   * least `queryKeys.walletBalance(address)`; vault flows add `queryKeys.vault`.
   */
  invalidate?: QueryKey[];
  /** Run after the tx confirms and invalidations fire — e.g. clear a form. */
  onSuccess?: (hash: string, input: TInput) => void;
}

/**
 * One-stop hook for any signed-tx flow: builds the tx, opens a pending toast,
 * hands the unsigned XDR to the wallet, polls the RPC for inclusion, surfaces
 * structured contract errors via SubmitError → sonner, and invalidates the
 * caches that depend on the result. Wraps `useMutation` so call-sites still
 * get `{ mutate, isPending, error }`.
 */
export function useTxMutation<TInput = void>(opts: UseTxMutationOptions<TInput>) {
  const { signTransaction } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: TInput) => {
      const t = txToast({ action: opts.action, successDetail: opts.successDetail });
      try {
        const tx = await opts.build(input);
        const result = await signAndSendWithWallet(tx, signTransaction);
        t.success();
        return { hash: result.hash, input };
      } catch (e) {
        t.error(e);
        throw e;
      }
    },
    onSuccess: ({ hash, input }) => {
      for (const key of opts.invalidate ?? []) {
        qc.invalidateQueries({ queryKey: key });
      }
      opts.onSuccess?.(hash, input);
    },
  });
}
