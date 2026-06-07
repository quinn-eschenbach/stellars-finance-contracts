import { useRef, useState, type RefObject } from "react";
import { Rnd } from "react-rnd";
import { Button, Window, WindowHeader } from "react95";
import { APPS } from "./apps";
import {
  MIN_SIZE,
  defaultGeometry,
  loadGeometry,
  saveGeometry,
  type Geometry,
} from "./geometry";
import { useIsSmallScreen } from "./useSmallScreen";
import { useWindowManager, type DesktopWindow } from "./wm";

interface WindowFrameProps {
  win: DesktopWindow;
  /** Position in the z-order — also used for cascade placement of new windows. */
  index: number;
  focused: boolean;
  desktopRef: RefObject<HTMLDivElement | null>;
}

/**
 * One floating Win95 window: react-rnd supplies drag/resize, react95 supplies
 * the chrome. Content stays mounted while minimized (display:none) so charts
 * and SSE subscriptions keep their state.
 */
export function WindowFrame({ win, index, focused, desktopRef }: WindowFrameProps) {
  const wm = useWindowManager();
  const def = APPS[win.kind];
  const small = useIsSmallScreen();
  const maximized = win.maximized || small;

  const [geom, setGeom] = useState<Geometry>(() => {
    const saved = loadGeometry(win.id);
    if (saved) return saved;
    const el = desktopRef.current;
    return defaultGeometry(
      win.kind,
      index,
      el
        ? { width: el.clientWidth, height: el.clientHeight }
        : { width: window.innerWidth, height: window.innerHeight - 44 },
    );
  });

  const persist = (next: Geometry) => {
    setGeom(next);
    saveGeometry(win.id, next);
  };

  // Refocusing on every mousedown anywhere in the window, capture phase so
  // button clicks inside content still raise the window first.
  const rootRef = useRef<HTMLDivElement | null>(null);

  const Component = def.component;

  return (
    <Rnd
      style={{ zIndex: 100 + index, display: win.minimized ? "none" : undefined }}
      bounds="parent"
      dragHandleClassName="w95-drag"
      size={maximized ? { width: "100%", height: "100%" } : { width: geom.width, height: geom.height }}
      position={maximized ? { x: 0, y: 0 } : { x: geom.x, y: geom.y }}
      minWidth={MIN_SIZE[win.kind].width}
      minHeight={MIN_SIZE[win.kind].height}
      disableDragging={maximized}
      enableResizing={!maximized}
      onDragStart={() => wm.focus(win.id)}
      onDragStop={(_e, d) => persist({ ...geom, x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        persist({ x: pos.x, y: pos.y, width: ref.offsetWidth, height: ref.offsetHeight })
      }
    >
      <div
        ref={rootRef}
        className="h-full w-full"
        onMouseDownCapture={() => {
          if (!focused) wm.focus(win.id);
        }}
      >
        <Window className="!flex h-full w-full !flex-col">
          <WindowHeader
            active={focused}
            className="w95-drag !flex h-[33px] shrink-0 select-none items-center justify-between gap-2"
            onDoubleClick={() => !small && wm.toggleMaximize(win.id)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <img
                src={def.icon}
                alt=""
                aria-hidden
                className="h-4 w-4 shrink-0"
                style={{ imageRendering: "pixelated" }}
              />
              <span className="truncate text-sm">{def.title(win.param)}</span>
            </span>
            <span className="flex shrink-0 gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
              <Button size="sm" square aria-label="Minimize" onClick={() => wm.minimize(win.id)}>
                {/* MS Sans Serif lacks the box-drawing glyphs — paint the
                    classic min/max/restore symbols with CSS instead. */}
                <span aria-hidden className="mt-[7px] block h-[2px] w-[6px] bg-black" />
              </Button>
              {!small && (
                <Button
                  size="sm"
                  square
                  aria-label={win.maximized ? "Restore" : "Maximize"}
                  onClick={() => wm.toggleMaximize(win.id)}
                >
                  {win.maximized ? (
                    <span aria-hidden className="relative block h-[10px] w-[10px]">
                      <span className="absolute right-0 top-0 h-[7px] w-[7px] border border-black border-t-2" />
                      <span className="absolute bottom-0 left-0 h-[7px] w-[7px] border border-black border-t-2 bg-[#c6c6c6]" />
                    </span>
                  ) : (
                    <span aria-hidden className="block h-[9px] w-[9px] border border-black border-t-2" />
                  )}
                </Button>
              )}
              <Button size="sm" square aria-label="Close" onClick={() => wm.close(win.id)}>
                <span aria-hidden className="-mt-0.5 font-bold leading-none">
                  ×
                </span>
              </Button>
            </span>
          </WindowHeader>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <Component param={win.param} />
          </div>
        </Window>
      </div>
    </Rnd>
  );
}
