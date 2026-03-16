import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTool permanent shortcuts (tap)", () => {
  it("should start with brush tool", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");
  });

  it("should switch to pan tool on H key tap", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("h"));
    // Release quickly (tap)
    act(() => fireKeyUp("h"));
    expect(result.current.activeTool).toBe("pan");
  });

  it("should switch to zoom tool on Z key tap", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("z"));
    act(() => fireKeyUp("z"));
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should switch to eyedropper on I key tap", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("i"));
    act(() => fireKeyUp("i"));
    expect(result.current.activeTool).toBe("eyedropper");
  });

  it("should switch to brush on B key tap", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("h");
      fireKeyUp("h");
    });
    act(() => {
      fireKeyDown("b");
      fireKeyUp("b");
    });
    expect(result.current.activeTool).toBe("brush");
  });

  it("should handle uppercase keys", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("H");
      fireKeyUp("H");
    });
    expect(result.current.activeTool).toBe("pan");
  });
});

describe("useTool spring-loaded shortcuts (hold tool key >200ms)", () => {
  it("should revert tool when key held longer than threshold", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");

    act(() => fireKeyDown("z"));
    expect(result.current.activeTool).toBe("zoom");

    // Hold for 250ms then release
    act(() => vi.advanceTimersByTime(250));
    act(() => fireKeyUp("z"));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should keep tool when key tapped quickly (<200ms)", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");

    act(() => fireKeyDown("z"));
    expect(result.current.activeTool).toBe("zoom");

    // Release within 100ms (tap)
    act(() => vi.advanceTimersByTime(100));
    act(() => fireKeyUp("z"));
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should spring-load the eyedropper tool via I key", () => {
    const { result } = renderHook(() => useTool());

    act(() => fireKeyDown("i"));
    expect(result.current.activeTool).toBe("eyedropper");

    act(() => vi.advanceTimersByTime(300));
    act(() => fireKeyUp("i"));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should not revert if same tool key pressed when already on that tool", () => {
    const { result } = renderHook(() => useTool());

    // Already on brush, press B
    act(() => fireKeyDown("b"));
    act(() => vi.advanceTimersByTime(300));
    act(() => fireKeyUp("b"));
    expect(result.current.activeTool).toBe("brush");
  });
});

describe("useTool always-temporary keys", () => {
  it("should temporarily switch to pan on spacebar hold", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");

    act(() => fireKeyDown(" "));
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" "));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should restore previous tool after spacebar release from zoom", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("z");
      fireKeyUp("z");
    });
    expect(result.current.activeTool).toBe("zoom");

    act(() => fireKeyDown(" "));
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" "));
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should not activate when spacebar held while already on pan", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("h");
      fireKeyUp("h");
    });
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyDown(" "));
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" "));
    // No previous to restore, stays on pan
    expect(result.current.activeTool).toBe("pan");
  });

  it("should ignore repeated keydown events", () => {
    const { result } = renderHook(() => useTool());

    act(() => fireKeyDown(" "));
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyDown(" ", { repeat: true }));
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyUp(" "));
    expect(result.current.activeTool).toBe("brush");
  });
});

describe("useTool modifier-key temporary overrides", () => {
  it("should temporarily switch to eyedropper on Alt while on brush", () => {
    const { result } = renderHook(() => useTool());
    expect(result.current.activeTool).toBe("brush");

    act(() => fireKeyDown("Alt"));
    expect(result.current.activeTool).toBe("eyedropper");

    act(() => fireKeyUp("Alt"));
    expect(result.current.activeTool).toBe("brush");
  });

  it("should not change tool on Alt when no modifier mapping exists", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("z");
      fireKeyUp("z");
    });
    expect(result.current.activeTool).toBe("zoom");

    act(() => fireKeyDown("Alt"));
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should not change tool on Alt while on pan (not a Photoshop shortcut)", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("h");
      fireKeyUp("h");
    });
    expect(result.current.activeTool).toBe("pan");

    act(() => fireKeyDown("Alt"));
    expect(result.current.activeTool).toBe("zoom");
  });
});

describe("useTool selectTool (programmatic)", () => {
  it("should switch tool programmatically", () => {
    const { result } = renderHook(() => useTool());

    act(() => result.current.selectTool("zoom"));
    expect(result.current.activeTool).toBe("zoom");
  });

  it("should clear spring-loaded state on programmatic switch", () => {
    const { result } = renderHook(() => useTool());

    act(() => fireKeyDown(" "));
    expect(result.current.activeTool).toBe("pan");

    act(() => result.current.selectTool("zoom"));
    expect(result.current.activeTool).toBe("zoom");

    act(() => fireKeyUp(" "));
    // Should stay on zoom, not revert
    expect(result.current.activeTool).toBe("zoom");
  });
});

describe("useTool selection tool shortcuts", () => {
  it("should switch to marquee on M key tap", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("m");
      fireKeyUp("m");
    });
    expect(result.current.activeTool).toBe("marquee");
  });

  it("should switch to lasso on L key tap", () => {
    const { result } = renderHook(() => useTool());
    act(() => {
      fireKeyDown("l");
      fireKeyUp("l");
    });
    expect(result.current.activeTool).toBe("lasso");
  });

  it("should spring-load marquee tool on M hold", () => {
    const { result } = renderHook(() => useTool());
    act(() => fireKeyDown("m"));
    expect(result.current.activeTool).toBe("marquee");

    act(() => vi.advanceTimersByTime(300));
    act(() => fireKeyUp("m"));
    expect(result.current.activeTool).toBe("brush");
  });
});
