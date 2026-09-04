import { describe, expect, it } from "vitest";
import { removeConnectedLightBackground } from "./portraitImage";

describe("portrait background cleanup", () => {
  it("removes only light pixels connected to the canvas edge", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 20, 20, 20, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);

    expect(removeConnectedLightBackground(pixels, 3, 3)).toBe(true);
    expect(pixels[3]).toBe(0);
    expect(pixels[4 * 4 + 3]).toBe(255);
  });

  it("keeps a light area enclosed by the subject", () => {
    const pixels = new Uint8ClampedArray(5 * 5 * 4);
    for (let index = 0; index < 25; index += 1) {
      const offset = index * 4;
      const x = index % 5;
      const y = Math.floor(index / 5);
      const border = x === 0 || x === 4 || y === 0 || y === 4;
      const center = x === 2 && y === 2;
      const value = border || center ? 255 : 20;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }

    removeConnectedLightBackground(pixels, 5, 5);
    expect(pixels[(2 * 5 + 2) * 4 + 3]).toBe(255);
  });
});
