import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BiasGauge } from "./bias-gauge";

const SCALE = 10_000_000n;

describe("<BiasGauge />", () => {
  it("renders the empty placeholder when there's no OI on either side", () => {
    const { container } = render(<BiasGauge longOi={0n} shortOi={0n} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("no OI")).toBeInTheDocument();
    // The empty state svg is aria-hidden.
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("labels strong long bias as Bullish and exposes an accessible name", () => {
    render(<BiasGauge longOi={75n * SCALE} shortOi={25n * SCALE} />);
    expect(screen.getByText("Bullish")).toBeInTheDocument();
    expect(screen.getByText("75% long")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Bullish bias, 75% long/i }),
    ).toBeInTheDocument();
  });

  it("labels strong short bias as Bearish", () => {
    render(<BiasGauge longOi={20n * SCALE} shortOi={80n * SCALE} />);
    expect(screen.getByText("Bearish")).toBeInTheDocument();
    expect(screen.getByText("20% long")).toBeInTheDocument();
  });

  it("labels a balanced market as Neutral", () => {
    render(<BiasGauge longOi={50n * SCALE} shortOi={50n * SCALE} />);
    expect(screen.getByText("Neutral")).toBeInTheDocument();
    expect(screen.getByText("50% long")).toBeInTheDocument();
  });

  it("accepts protocol-scaled string OI", () => {
    render(
      <BiasGauge longOi={(40n * SCALE).toString()} shortOi={(60n * SCALE).toString()} />,
    );
    expect(screen.getByText("40% long")).toBeInTheDocument();
  });

  it("scales the SVG to the size prop", () => {
    const { container } = render(<BiasGauge longOi={SCALE} shortOi={SCALE} size={240} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("240");
  });

  it("survives huge bigint OI without overflow", () => {
    // 1e30 is way past Number.MAX_SAFE_INTEGER — the component divides inside
    // bigint as a 4-decimal scale before casting, so this must not throw.
    const huge = 10n ** 30n;
    expect(() => render(<BiasGauge longOi={huge * 3n} shortOi={huge} />)).not.toThrow();
    expect(screen.getByText("75% long")).toBeInTheDocument();
  });
});
