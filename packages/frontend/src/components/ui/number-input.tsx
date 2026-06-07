import { useEffect, useRef, useState } from "react";
import { Button, TextInput } from "react95";
import { cn, numberToAmount } from "@/lib/utils";

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  width?: string | number;
  className?: string;
}

/**
 * Win95 spin-button number field. react95's own NumberInput only propagates
 * typed values on blur (controlled typing snaps back every keystroke), so we
 * compose the same look from TextInput + two spinner Buttons and keep a local
 * text buffer: the field owns its text while focused, and external value
 * changes (preset buttons) sync it when it's not.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  width = "100%",
  className,
}: NumberInputProps) {
  const [text, setText] = useState(() => numberToAmount(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(numberToAmount(value));
  }, [value]);

  const clamp = (n: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));

  const handleText = (t: string) => {
    setText(t);
    const parsed = Number(t.replace(",", "."));
    if (t.trim() === "") {
      onChange(clamp(0));
    } else if (Number.isFinite(parsed)) {
      onChange(clamp(parsed));
    }
    // Unparseable garbage stays in the buffer; blur snaps back to the value.
  };

  const stepBy = (delta: number) => {
    const next = clamp(Math.round((value + delta) * 1e7) / 1e7);
    onChange(next);
    setText(numberToAmount(next));
  };

  return (
    <div
      className={cn("flex items-stretch", className)}
      style={{ width: typeof width === "number" ? `${width}px` : width }}
    >
      <TextInput
        value={text}
        onChange={(e) => handleText(e.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          setText(numberToAmount(value));
        }}
        disabled={disabled}
        type="text"
        inputMode="decimal"
        fullWidth
        className="min-w-0 flex-1"
      />
      <div className="ml-0.5 flex shrink-0 flex-col justify-between">
        <Button
          aria-label="Increment"
          disabled={disabled}
          onClick={() => stepBy(step)}
          className="!h-[17px] !w-[30px] !p-0"
        >
          <span
            aria-hidden
            className="block h-0 w-0 border-x-4 border-x-transparent border-b-4 border-b-black"
          />
        </Button>
        <Button
          aria-label="Decrement"
          disabled={disabled}
          onClick={() => stepBy(-step)}
          className="!h-[17px] !w-[30px] !p-0"
        >
          <span
            aria-hidden
            className="block h-0 w-0 border-x-4 border-x-transparent border-t-4 border-t-black"
          />
        </Button>
      </div>
    </div>
  );
}
