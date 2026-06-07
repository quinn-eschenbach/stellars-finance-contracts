import { useEffect, useRef, useState } from "react";
import { Button, MenuList, MenuListItem, Separator } from "react95";
import { useWallet } from "@/wallet/WalletProvider";
import { shortAddress } from "@/lib/utils";
import { useLauncherItems, type LauncherItem } from "./apps";
import { ICONS } from "./icons";
import { useLogon } from "./Logon";
import { useWindowManager } from "./wm";

/** Start button + pop-up menu, anchored to the bottom taskbar. */
export function StartMenu() {
  const wm = useWindowManager();
  const { status, disconnect } = useWallet();
  const { requestLogon } = useLogon();
  const { markets, apps, marketsLoading } = useLauncherItems();
  const [open, setOpen] = useState(false);
  const [marketsOpen, setMarketsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const connected = status.kind === "ok";

  // Close when clicking anywhere outside the menu — Win95 behavior.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setMarketsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const launch = (item: LauncherItem) => {
    wm.open(item.kind, item.param);
    setOpen(false);
    setMarketsOpen(false);
  };

  async function handleLogOff() {
    setOpen(false);
    await disconnect();
    requestLogon();
  }

  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen((v) => !v)} active={open} className="!font-bold">
        <span aria-hidden className="mr-1.5 text-base leading-none">
          ✶
        </span>
        Start
      </Button>

      {open && (
        <MenuList className="!absolute !bottom-full !left-0 z-[600] !flex w-60 !p-0">
          {/* Vertical brand stripe, like the Windows95 banner. */}
          <div className="flex w-7 shrink-0 items-end justify-center self-stretch bg-[#000080] py-2">
            <span
              className="select-none text-sm font-bold tracking-wide text-white"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              Stellars<span className="font-normal opacity-80">95</span>
            </span>
          </div>

          <div className="min-w-0 flex-1 py-1">
            <div
              className="relative"
              onMouseEnter={() => setMarketsOpen(true)}
              onMouseLeave={() => setMarketsOpen(false)}
            >
              <MenuListItem square={false} className="!flex !justify-between gap-2">
                <span className="flex items-center gap-2">
                  <MenuIcon src={ICONS.chart} />
                  Markets
                </span>
                <span aria-hidden>▸</span>
              </MenuListItem>
              {marketsOpen && (
                <MenuList className="!absolute !bottom-0 !left-full z-[600] w-44">
                  {markets.map((item) => (
                    <MenuListItem
                      key={item.id}
                      square={false}
                      onClick={() => launch(item)}
                      className="!flex !justify-start gap-2"
                    >
                      <MenuIcon src={item.icon} />
                      {item.label}
                    </MenuListItem>
                  ))}
                  {marketsLoading && (
                    <MenuListItem square={false} disabled>
                      Loading…
                    </MenuListItem>
                  )}
                  {!marketsLoading && markets.length === 0 && (
                    <MenuListItem square={false} disabled>
                      No markets
                    </MenuListItem>
                  )}
                </MenuList>
              )}
            </div>

            {apps.map((item) => (
              <MenuListItem
                key={item.id}
                square={false}
                onClick={() => launch(item)}
                className="!flex !justify-start gap-2"
              >
                <MenuIcon src={item.icon} />
                {item.label}
              </MenuListItem>
            ))}

            <Separator />

            {connected ? (
              <MenuListItem
                square={false}
                onClick={handleLogOff}
                className="!flex !justify-start gap-2"
              >
                <MenuIcon src={ICONS.keys} />
                Log Off {shortAddress(status.address, 4, 4)}…
              </MenuListItem>
            ) : (
              <MenuListItem
                square={false}
                onClick={() => {
                  setOpen(false);
                  requestLogon();
                }}
                className="!flex !justify-start gap-2"
              >
                <MenuIcon src={ICONS.keys} />
                Log On…
              </MenuListItem>
            )}
          </div>
        </MenuList>
      )}
    </div>
  );
}

function MenuIcon({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className="h-5 w-5 shrink-0"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
