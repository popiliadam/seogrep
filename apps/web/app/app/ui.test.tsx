import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeltaAmount, KindBadge, LedgerTable, StatCard } from "./ui";

describe("app dashboard ui", () => {
  it("KindBadge maps kinds to human labels (spend_commit -> neutral 'commit')", () => {
    render(
      <>
        <KindBadge kind="grant" />
        <KindBadge kind="spend_reserve" />
        <KindBadge kind="spend_commit" />
      </>,
    );
    expect(screen.getByText("grant")).toBeTruthy();
    expect(screen.getByText("reserve")).toBeTruthy();
    expect(screen.getByText("commit")).toBeTruthy();
  });

  it("DeltaAmount prefixes positives with + and leaves zero unsigned", () => {
    render(
      <>
        <DeltaAmount delta={200} />
        <DeltaAmount delta={-50} />
        <DeltaAmount delta={0} />
      </>,
    );
    expect(screen.getByText("+200")).toBeTruthy();
    expect(screen.getByText("-50")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("StatCard shows its label and value", () => {
    render(<StatCard label="Available credits" value="1,234" />);
    expect(screen.getByText("Available credits")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
  });

  it("LedgerTable shows the empty state, then renders a row (date + kind + signed delta)", () => {
    const { rerender } = render(<LedgerTable entries={[]} />);
    expect(screen.getByText("No activity yet.")).toBeTruthy();

    rerender(
      <LedgerTable
        entries={[
          {
            id: 1,
            createdAt: "2026-07-01T12:00:00.000Z",
            delta: 200,
            kind: "grant",
            reason: "trial",
            tool: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("2026-07-01")).toBeTruthy();
    expect(screen.getByText("grant")).toBeTruthy();
    expect(screen.getByText("+200")).toBeTruthy();
  });
});
