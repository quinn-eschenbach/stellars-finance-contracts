import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BiasBar } from "./bias-bar";

const SCALE = 10_000_000n;

describe("<BiasBar />", () => {
  it("shows 'no OI' when both sides are zero", () => {
    render(<BiasBar longOi={0n} shortOi={0n} />);
    expect(screen.getByText("no OI")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("labels strong long bias as Bullish", () => {
    render(<BiasBar longOi={70n * SCALE} shortOi={30n * SCALE} />);
    expect(screen.getByText("Bullish")).toBeInTheDocument();
    expect(screen.getByText("70% long")).toBeInTheDocument();
  });

  it("labels strong short bias as Bearish", () => {
    render(<BiasBar longOi={30n * SCALE} shortOi={70n * SCALE} />);
    expect(screen.getByText("Bearish")).toBeInTheDocument();
    expect(screen.getByText("30% long")).toBeInTheDocument();
  });

  it("labels evenly-matched OI as Neutral", () => {
    render(<BiasBar longOi={50n * SCALE} shortOi={50n * SCALE} />);
    expect(screen.getByText("Neutral")).toBeInTheDocument();
    expect(screen.getByText("50% long")).toBeInTheDocument();
  });

  it("accepts numeric-string inputs (the API serialization format)", () => {
    render(<BiasBar longOi={(60n * SCALE).toString()} shortOi={(40n * SCALE).toString()} />);
    expect(screen.getByText("60% long")).toBeInTheDocument();
  });

  it("uses 0.62 as the Bullish threshold (boundary in-band)", () => {
    // 0.62 share → Bullish; 0.61 → Neutral.
    render(<BiasBar longOi={62n * SCALE} shortOi={38n * SCALE} />);
    expect(screen.getByText("Bullish")).toBeInTheDocument();
  });

  it("uses 0.38 as the Bearish threshold (boundary in-band)", () => {
    render(<BiasBar longOi={38n * SCALE} shortOi={62n * SCALE} />);
    expect(screen.getByText("Bearish")).toBeInTheDocument();
  });
});
