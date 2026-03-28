import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrushSettingsPanel } from "../components/BrushSettingsPanel";
import type { BrushSettings } from "../hooks/useBrushSettings";
import { DEFAULT_WET_MEDIA } from "../hooks/useBrushSettings";

function makeSettings(overrides: Partial<BrushSettings> = {}): BrushSettings {
  return {
    size: 20,
    opacity: 1.0,
    flow: 0.8,
    smoothing: 0,
    spacing: 0.15,
    hardness: 1.0,
    roundness: 1.0,
    angle: 0,
    flipX: false,
    flipY: false,
    shapeDynamics: {
      size: { jitter: 0, control: 0, minimum: 0 },
      angle: { jitter: 0, control: 0, minimum: 0 },
      roundness: { jitter: 0, control: 0, minimum: 0 },
    },
    transferDynamics: {
      opacity: { jitter: 0, control: 0, minimum: 0 },
      flow: { jitter: 0, control: 0, minimum: 0 },
    },
    scatterSettings: { scatter: 0, bothAxes: false, count: 1, countJitter: 0 },
    dualBrush: {
      enabled: false, mode: 0, useComputed: true, hardness: 1.0,
      sizeRatio: 1.0, spacing: 0.25, flip: false, count: 1,
      countJitter: 0, scatter: 0, bothAxes: false,
    },
    texture: { enabled: false, scale: 100, depth: 1.0, textureEachTip: false },
    wetMedia: { ...DEFAULT_WET_MEDIA, enabled: true },
    activeTipId: null,
    ...overrides,
  };
}

describe("BrushSettingsPanel WetMedia", () => {
  it("renders medium selector when wet media is enabled", () => {
    const onUpdate = vi.fn();
    const settings = makeSettings();

    render(
      createElement(BrushSettingsPanel, {
        settings,
        storage: null,
        onUpdate,
        onToggleTipType: () => {},
        onToggleDualBrushType: () => {},
      }),
    );

    // Open the popover
    const triggers = screen.getAllByText("Brush Settings");
    fireEvent.click(triggers[0]);

    // Navigate to Wet Media category
    const wetMediaButtons = screen.getAllByText("Wet Media");
    fireEvent.click(wetMediaButtons[0]);

    // Medium selector buttons should be visible
    expect(screen.getByText("Oil")).toBeTruthy();
    expect(screen.getByText("Acrylic")).toBeTruthy();
    expect(screen.getByText("Watercolor")).toBeTruthy();

    // Clicking Acrylic should call onUpdate with the new medium type
    fireEvent.click(screen.getByText("Acrylic"));

    expect(onUpdate).toHaveBeenCalledWith("wetMedia", expect.objectContaining({
      mediumType: "Acrylic",
    }));
  });
});
