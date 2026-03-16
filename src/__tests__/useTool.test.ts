import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTool } from "../hooks/useTool";

function fireKeyDown(key: string, options: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
  );
}

function fireKeyUp(key: string, options: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keyup", { key, bubbles: true, ...options }),
  );
}

describe("useTool keyboard shortcuts", () => {
  it("should start with brush tool", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");
  });

  it("should switch to pan tool on H key", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("h"));
    expect(result.current.activeTool).toBe("pan");
  });

  it("should switch to zoom tool on Z key", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("z"));
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should switch to brush tool on B key", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("h")); // switch away first
    act(() => fireKeyDown("b"));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should handle uppercase keys", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("H"));
    expect(result.current.activeTool).toBe("pan");
  });

  it("should temporarily switch to pan on spacebar hold", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");

    act(() => fireKeyDown(" "));
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" "));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should restore previous tool after spacebar release", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("z")); // switch to zoom
    expect(result.current.activeTool).toBe("zoom");

    act(() => fireKeyDown(" ")); // hold space
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" ")); // release
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should not restore if permanent key pressed during temp hold", () => {
    const { result } = renderHook(() => useTool());

    act(() => fireKeyDown(" ")); // hold space for temp pan
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyDown("z")); // permanent switch to zoom
    expect(result.current.activeTool).toBe("zoom");

    act(() => fireKeyUp(" ")); // release space — should stay on zoom
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should ignore repeated keydown events", () => {
    const { result } = renderHook(() => useTool());

    act(() => fireKeyDown(" "));
    expect(result.current.activeTool).toBe("pan");

    // Simulated key repeat — should not overwrite previousTool
    act(() => fireKeyDown(" ", { repeat: true }));
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" "));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should not activate when spacebar already held as pan", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("h")); // already on pan
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyDown(" ")); // space when already pan
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" ")); // release — should stay pan (no previous to restore)
    expect(result.current.activeTool).toBe("pan");
  });

  it("should use selectTool for programmatic changes", () => {
    const { result } = renderHook(() => useTool());

    act(() => result.current.selectTool("zoom"));
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should switch to eyedropper on I key", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("i"));
    expect(result.current.activeTool).toBe("eyedropper");
  });

  it("should temporarily switch to eyedropper on Alt while on brush", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");

    act(() => fireKeyDown("Alt"));
    expect(result.current.activeTool).toBe("eyedropper");

    act(() => fireKeyUp("Alt"));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should temporarily switch to zoom on Alt while on pan", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("h")); // switch to pan
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyDown("Alt"));
    expect(result.current.activeTool).toBe("zoom");

    act(() => fireKeyUp("Alt"));
    expect(result.current.activeTool).toBe("pan");
  });

  it("should not change tool on Alt when no modifier mapping exists", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("z")); // switch to zoom
    expect(result.current.activeTool).toBe("zoom");

    act(() => fireKeyDown("Alt"));
    // No mapping for zoom+Alt, should stay on zoom
    expect(result.current.activeTool).toBe("zoom");
  });
});
