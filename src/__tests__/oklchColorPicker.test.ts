import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { OklchColorPicker } from "../components/OklchColorPicker";

// Mock canvas getContext since happy-dom doesn't support it
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  createImageData: (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  }),
  putImageData: vi.fn(),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

describe("OklchColorPicker", () => {
  it("renders without crashing", () => {
    const onChange = vi.fn();
    const { container } = render(
      createElement(OklchColorPicker, { color: "#ff0000", onChange }),
    );
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("renders hex input with current color", () => {
    const onChange = vi.fn();
    const { container } = render(
      createElement(OklchColorPicker, { color: "#ff0000", onChange }),
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("#ff0000");
  });

  it("calls onChange with valid hex on hex input change", () => {
    const onChange = vi.fn();
    const { container } = render(
      createElement(OklchColorPicker, { color: "#ff0000", onChange }),
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenCalledWith("#00ff00");
  });

  it("does not call onChange for invalid hex input", () => {
    const onChange = vi.fn();
    const { container } = render(
      createElement(OklchColorPicker, { color: "#ff0000", onChange }),
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#xyz" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reverts invalid hex on blur", () => {
    const onChange = vi.fn();
    const { container } = render(
      createElement(OklchColorPicker, { color: "#ff0000", onChange }),
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#xyz" } });
    fireEvent.blur(input);
    // Should revert to the current color's hex
    expect(input.value).toBe("#ff0000");
  });

  it("updates when color prop changes", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      createElement(OklchColorPicker, { color: "#ff0000", onChange }),
    );
    rerender(
      createElement(OklchColorPicker, { color: "#0000ff", onChange }),
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    expect(input.value).toBe("#0000ff");
  });
});
