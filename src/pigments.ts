export interface Pigment {
  id: string;
  name: string;
  rgb: [number, number, number];
  K: [number, number, number];
  S: [number, number, number];
  opacity: "opaque" | "semi-opaque" | "semi-transparent" | "transparent";
}

import pigmentData from "../data/pigments.json";

export const PIGMENTS: Pigment[] = pigmentData as Pigment[];

export function getPigmentById(id: string): Pigment | undefined {
  return PIGMENTS.find((p) => p.id === id);
}

export function getPigmentKS(pigment: Pigment): {
  K: Float32Array;
  S: Float32Array;
} {
  return {
    K: new Float32Array(pigment.K),
    S: new Float32Array(pigment.S),
  };
}
