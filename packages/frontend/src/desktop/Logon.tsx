import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, Frame, Hourglass, Window, WindowHeader } from "react95";
import { WellNote } from "@/components/ui/well-note";
import { useWallet } from "@/wallet/WalletProvider";
import { ICONS } from "./icons";

interface LogonContextValue {
  /** Re-show the logon dialog (Start menu "Log On…", connect prompts in apps). */
  requestLogon: () => void;
}

const LogonContext = createContext<LogonContextValue>({ requestLogon: () => {} });

export function useLogon(): LogonContextValue {
  return useContext(LogonContext);
}

/**
 * The one expression of "this needs a wallet" for read-only mode. Renders an
 * optional explainer well plus the Log On button wired to the logon dialog —
 * leaf components use this instead of hand-rolling the prompt.
 */
export function LogOnPrompt({
  message,
  buttonLabel = "Log On…",
}: {
  message?: string;
  buttonLabel?: string;
}) {
  const { requestLogon } = useLogon();
  return (
    <div className="space-y-3">
      {message && <WellNote>{message}</WellNote>}
      <Button primary onClick={requestLogon} className="w-full !font-bold">
        {buttonLabel}
      </Button>
    </div>
  );
}

/**
 * Win95-style logon gate. Shows a logon dialog over a bare teal screen until
 * the user connects a wallet — or hits Cancel, which drops them onto a
 * read-only desktop, exactly like cancelling the Windows logon did.
 */
export function LogonGate({ children }: { children: ReactNode }) {
  const { status, ready, connect } = useWallet();
  const [dismissed, setDismissed] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = ready && status.kind !== "ok" && !dismissed;

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      await connect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect wallet.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <LogonContext.Provider value={{ requestLogon: () => setDismissed(false) }}>
      {children}
      {!ready && <div className="fixed inset-0 z-[700] bg-[#008080]" />}
      {show && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center bg-[#008080] p-4">
          <Window className="w-[440px] max-w-full">
            <WindowHeader className="!flex items-center gap-1.5">
              <img
                src={ICONS.keys}
                alt=""
                aria-hidden
                className="h-4 w-4"
                style={{ imageRendering: "pixelated" }}
              />
              <span className="text-sm">Welcome to Stellars Finance</span>
            </WindowHeader>
            <div className="flex gap-4 p-4">
              <img
                src={ICONS.computer}
                alt=""
                aria-hidden
                className="h-8 w-8 shrink-0"
                style={{ imageRendering: "pixelated" }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <p className="text-sm leading-snug">
                  Connect a Stellar wallet to log on to Stellars Finance.
                </p>
                <p className="text-xs leading-snug">
                  Press Cancel to browse markets without logging on — trading, vault deposits
                  and the faucet stay locked until you connect.
                </p>
                {error && (
                  <Frame variant="well" className="!block !px-2 !py-1 text-xs text-destructive">
                    {error}
                  </Frame>
                )}
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  {connecting && <Hourglass size={20} />}
                  <Button
                    primary
                    disabled={connecting}
                    onClick={handleConnect}
                    className="w-24 !font-bold"
                  >
                    OK
                  </Button>
                  <Button disabled={connecting} onClick={() => setDismissed(true)} className="w-24">
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </Window>
        </div>
      )}
    </LogonContext.Provider>
  );
}
