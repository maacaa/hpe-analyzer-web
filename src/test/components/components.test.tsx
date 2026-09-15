// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SevBadge } from "../../components/ImlTab";
import { ProgressBar } from "../../components/ProgressBar";
import { DropZone } from "../../components/DropZone";

describe("SevBadge", () => {
  it("renders the severity label", () => {
    const { container } = render(<SevBadge sev="critical" />);
    expect(container.firstChild).toHaveClass("sev-critical");
    expect(container.textContent).toBe("critical");
  });
});

describe("ProgressBar", () => {
  it("shows percentage", () => {
    render(<ProgressBar progress={{ phase: "x.zbb", done: 50, total: 100, pct: 50 }} />);
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });

  it("renders without progress", () => {
    render(<ProgressBar progress={null} />);
    expect(screen.getByText("0.0%")).toBeInTheDocument();
  });
});

describe("DropZone", () => {
  it("calls onFile when a file is dropped", () => {
    const onFile = vi.fn();
    const { container } = render(<DropZone onFile={onFile} onBrowse={() => {}} />);
    const zone = container.querySelector(".dropzone") as Element;
    fireEvent.drop(zone, {
      dataTransfer: { files: [{ name: "x.ahs" }] },
    });
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it("calls onBrowse when the button is clicked", () => {
    const onBrowse = vi.fn();
    render(<DropZone onFile={() => {}} onBrowse={onBrowse} />);
    fireEvent.click(screen.getByRole("button", { name: /browse files/i }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });
});
