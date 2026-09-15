// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VirtualList } from "../../components/VirtualList";

describe("VirtualList", () => {
  it("renders a small list without crashing (range clamped)", () => {
    const items = [1, 2, 3, 4, 5];
    const { container } = render(
      <VirtualList items={items} rowHeight={30} render={(n) => <span>item-{n}</span>} />
    );
    expect(container.textContent).toContain("item-1");
  });

  it("renders the empty state", () => {
    const { container } = render(
      <VirtualList items={[]} rowHeight={30} render={(n) => <span>item-{n}</span>} />
    );
    expect(container.textContent).toContain("No entries");
  });

  it("does not crash when the list shrinks (filter regression)", () => {
    const many = Array.from({ length: 100 }, (_, i) => i);
    const { rerender, container } = render(
      <VirtualList items={many} rowHeight={30} render={(n) => <span>i{n}</span>} />
    );
    // shrink to 2 items
    rerender(
      <VirtualList items={[0, 1]} rowHeight={30} render={(n) => <span>i{n}</span>} />
    );
    expect(container.textContent).toContain("i0");
    expect(container.textContent).toContain("i1");
    // shrink to empty
    rerender(<VirtualList items={[]} rowHeight={30} render={(n) => <span>i{n}</span>} />);
    expect(container.textContent).toContain("No entries");
  });

  it("shows the filtered rows instead of a blank viewport after deep scroll", () => {
    const many = Array.from({ length: 2000 }, (_, i) => i);
    const { rerender, container } = render(
      <VirtualList items={many} rowHeight={30} render={(n) => <span>i{n}</span>} />
    );
    const el = container.querySelector(".vlist") as HTMLElement;
    // simulate being scrolled deep into the big list
    el.scrollTop = many.length * 30;
    el.dispatchEvent(new Event("scroll"));
    // filter down to a handful of entries
    rerender(
      <VirtualList items={[0, 1, 2, 3, 4]} rowHeight={30} render={(n) => <span>i{n}</span>} />
    );
    // the first (visible) rows must render — not a blank tail
    expect(container.textContent).toContain("i0");
    expect(container.textContent).toContain("i1");
    expect(container.textContent).toContain("i4");
  });

  it("fires onNearEnd when the viewport reaches the end of the loaded items", () => {
    const items = [1, 2, 3];
    let nearEnd = 0;
    const { container } = render(
      <VirtualList
        items={items}
        rowHeight={30}
        render={(n) => <span>item-{n}</span>}
        onNearEnd={() => nearEnd++}
      />
    );
    expect(nearEnd).toBeGreaterThanOrEqual(1); // fired on mount (few items)
    const el = container.querySelector(".vlist") as HTMLElement;
    el.dispatchEvent(new Event("scroll"));
    expect(nearEnd).toBeGreaterThanOrEqual(2);
  });
});
