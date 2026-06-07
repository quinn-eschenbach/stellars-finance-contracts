import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Win95Provider } from "@/win95";
import { Button } from "./button";

// react95 components read their palette from the styled-components theme.
function renderWithTheme(ui: ReactNode) {
  return render(<Win95Provider>{ui}</Win95Provider>);
}

describe("<Button />", () => {
  it("renders its children as a real <button>", () => {
    renderWithTheme(<Button>Open long</Button>);
    const btn = screen.getByRole("button", { name: "Open long" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithTheme(<Button onClick={onClick}>Submit</Button>);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithTheme(
      <Button onClick={onClick} disabled>
        Submit
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("colors the label for side variants", () => {
    renderWithTheme(
      <Button variant="bull" size="sm">
        Long
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Long" });
    expect(btn.className).toMatch(/text-bull/);
  });
});
