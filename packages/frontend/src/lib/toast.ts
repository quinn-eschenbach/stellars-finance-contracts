import { toast as sonnerToast } from "sonner";
import { parseContractError, toErrorMessage, type SubmitErrorDetails } from "@/lib/contract-errors";
import { SubmitError } from "@/contracts/sender";

interface TxToastOptions {
  /** Short verb-noun describing the action ("Open long", "Withdraw"). Used for the title. */
  action: string;
  /** Optional context line — defaults to a generic confirmation prompt. */
  pending?: string;
  /** Optional success body. */
  successDetail?: string;
}

/**
 * Toast helpers for transaction lifecycles. They share a single id so the
 * pending toast upgrades into the success/error toast in place rather than
 * stacking three separate notifications per submission.
 */
export function txToast(opts: TxToastOptions) {
  const id = sonnerToast.loading(`${opts.action} · awaiting confirmation`, {
    description: opts.pending ?? "Sign the transaction in your wallet, then we'll watch it land.",
  });
  return {
    id,
    success(detail?: string) {
      sonnerToast.success(`${opts.action} confirmed`, {
        id,
        description: detail ?? opts.successDetail ?? "Transaction landed on Stellar.",
      });
    },
    error(err: unknown) {
      const { title, description } = errorTitleAndBody(opts.action, err);
      sonnerToast.error(title, { id, description });
    },
  };
}

/** Generic success toast (non-tx — e.g. "address copied"). */
export function toastSuccess(title: string, description?: string) {
  sonnerToast.success(title, { description });
}

/** Generic error toast for non-tx flows (e.g. validation errors). */
export function toastError(input: unknown, title = "Something went wrong") {
  sonnerToast.error(title, { description: toErrorMessage(input) });
}

/**
 * Pick the right title/description for a thrown value. SubmitError carries
 * structured details from sender.ts; everything else gets best-effort regex
 * parsing through parseContractError.
 */
function errorTitleAndBody(action: string, err: unknown): { title: string; description: string } {
  if (err instanceof SubmitError) {
    return { title: titleForSubmitError(action, err.details), description: err.details.message };
  }
  const parsed = parseContractError(err);
  if (parsed?.contract) {
    return { title: `${action} reverted · ${parsed.contract}`, description: parsed.message };
  }
  if (parsed) {
    // We detected an Error(Contract, #N) shape but couldn't pin the source
    // contract (no contract id in the message). Still surface "reverted" so
    // the user knows the chain rejected the call, just without the source.
    return { title: `${action} reverted · Contract`, description: parsed.message };
  }
  return { title: `${action} failed`, description: toErrorMessage(err) };
}

function titleForSubmitError(action: string, det: SubmitErrorDetails): string {
  switch (det.kind) {
    case "contract":
      return `${action} reverted · ${det.contract ?? "Contract"}`;
    case "host-function":
      return `${action} failed · host`;
    case "tx-level":
      return `${action} rejected${det.code ? ` · ${det.code}` : ""}`;
    case "timeout":
      return `${action} timed out`;
  }
}

/** Re-export for components that want full sonner control. */
export { sonnerToast as toast };
