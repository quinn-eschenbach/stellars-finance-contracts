import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("<Button />", () => {
  it("renders its children as a real <button> by default", () => {
    render(<Button>Open long</Button>);
    const btn = screen.getByRole("button", { name: "Open long" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Submit</Button>);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Submit
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders as its child element when asChild is set", () => {
    // asChild swaps the rendered tag from <button> to whatever child you give
    // it — used heavily for routing links that should look like buttons.
    render(
      <Button asChild>
        <a href="/trade">Trade</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Trade" });
    expect(link).toHaveAttribute("href", "/trade");
  });

  it("applies variant + size class names", () => {
    render(
      <Button variant="bull" size="sm">
        Long
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Long" });
    // Spot-check that variant/size class fragments made it through cva → cn.
    expect(btn.className).toMatch(/bull/);
    expect(btn.className).toMatch(/h-8/);
  });
});
