import { useEffect, useState } from "react";
import { AppBar, Button, Frame, Toolbar } from "react95";
import { useWallet } from "@/wallet/WalletProvider";
import { shortAddress } from "@/lib/utils";
import { APPS } from "./apps";
import { StartMenu } from "./StartMenu";
import { useWindowManager } from "./wm";

/** Bottom taskbar: Start menu, one button per open window, tray with clock. */
export function Taskbar() {
  const wm = useWindowManager();
  const { status } = useWallet();

  return (
    <AppBar position="static" className="!z-[500] shrink-0">
      <Toolbar className="gap-1 !px-1">
        <StartMenu />

        <Frame variant="status" className="mx-0.5 h-7 w-0 shrink-0" />

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {wm.windows.map((win) => (
            <Button
              key={win.id}
              active={!win.minimized && wm.focusedId === win.id}
              onClick={() => wm.taskbarActivate(win.id)}
              className="min-w-0 max-w-[180px] flex-1 !justify-start gap-1.5 !px-1.5"
            >
              <img
                src={APPS[win.kind].icon}
                alt=""
                aria-hidden
                className="h-4 w-4 shrink-0"
                style={{ imageRendering: "pixelated" }}
              />
              <span className="truncate text-sm font-normal">
                {APPS[win.kind].title(win.param)}
              </span>
            </Button>
          ))}
        </div>

        <Frame
          variant="status"
          className="!flex shrink-0 items-center gap-2 !px-2 !py-0.5 font-mono text-xs"
        >
          {status.kind === "ok" && (
            <>
              <span className="hidden sm:inline">{status.network}</span>
              <span className="hidden md:inline">{shortAddress(status.address)}</span>
            </>
          )}
          <Clock />
        </Frame>
      </Toolbar>
    </AppBar>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="tabular-nums">
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}
