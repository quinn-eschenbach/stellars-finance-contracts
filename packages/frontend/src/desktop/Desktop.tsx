import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useLauncherItems } from "./apps";
import { LogonGate } from "./Logon";
import { Taskbar } from "./Taskbar";
import { useIsSmallScreen } from "./useSmallScreen";
import { WindowFrame } from "./WindowFrame";
import { WindowManagerProvider, useWindowManager } from "./wm";

/** The whole Win95 shell: teal desktop, icons, floating windows, taskbar. */
export function Desktop() {
  return (
    <WindowManagerProvider>
      <LogonGate>
        <DesktopSurface />
      </LogonGate>
    </WindowManagerProvider>
  );
}

function DesktopSurface() {
  const wm = useWindowManager();
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 flex flex-col bg-[#008080]">
      <div
        ref={desktopRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        <DesktopIcons selected={selected} setSelected={setSelected} />
        {wm.windows.map((win, index) => (
          <WindowFrame
            key={win.id}
            win={win}
            index={index}
            focused={wm.focusedId === win.id}
            desktopRef={desktopRef}
          />
        ))}
      </div>
      <Taskbar />
    </div>
  );
}

function DesktopIcons({
  selected,
  setSelected,
}: {
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const wm = useWindowManager();
  const { markets, apps } = useLauncherItems();
  const small = useIsSmallScreen();

  const icons = [...markets, ...apps];

  return (
    <div className="absolute inset-0 flex flex-col flex-wrap content-start gap-1 p-2">
      {icons.map((item) => (
        <DesktopIcon
          key={item.id}
          icon={item.icon}
          label={item.label}
          selected={selected === item.id}
          onSelect={() => setSelected(item.id)}
          // Touch screens get single-tap launch; double-click everywhere else.
          onOpen={() => wm.open(item.kind, item.param)}
          singleClick={small}
        />
      ))}
    </div>
  );
}

function DesktopIcon({
  icon,
  label,
  selected,
  onSelect,
  onOpen,
  singleClick,
}: {
  icon: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  singleClick: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-[76px] flex-col items-center gap-1 p-1 focus:outline-none"
      onClick={() => {
        onSelect();
        if (singleClick) onOpen();
      }}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <img
        src={icon}
        alt=""
        aria-hidden
        className="h-8 w-8"
        style={{ imageRendering: "pixelated" }}
      />
      <span
        className={cn(
          "max-w-full px-0.5 text-center text-xs leading-tight text-white",
          selected ? "bg-[#000080]" : "[text-shadow:1px_1px_0_#000]",
        )}
      >
        {label}
      </span>
    </button>
  );
}
