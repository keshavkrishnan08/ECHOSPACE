import { z } from "zod";

/** Right-handed world frame: x = room width, y = room depth, z = up. Metres. */
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const Vec2 = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2>;

/**
 * Material categories with *simplified* single-number penetration losses.
 * These are coarse, frequency-agnostic placeholders for the 5 GHz band and are
 * documented in docs/simulation-model.md. They are not measured values.
 */
export const Material = z.enum(["drywall", "wood", "glass", "brick", "concrete", "metal", "fabric"]);
export type Material = z.infer<typeof Material>;

export const MATERIAL_PENETRATION_DB: Record<Material, number> = {
  fabric: 1,
  glass: 2,
  wood: 3,
  drywall: 4,
  brick: 8,
  concrete: 15,
  metal: 30,
};

/** Amplitude reflection coefficient used for first-order specular reflections. */
export const MATERIAL_REFLECTIVITY: Record<Material, number> = {
  fabric: 0.05,
  glass: 0.25,
  wood: 0.2,
  drywall: 0.3,
  brick: 0.4,
  concrete: 0.5,
  metal: 0.9,
};

export const Room = z.object({
  width: z.number().min(2).max(20),
  depth: z.number().min(2).max(20),
  height: z.number().min(2).max(6),
  wallMaterial: Material.default("drywall"),
  wallThickness: z.number().min(0.05).max(0.6).default(0.12),
  /** Overrides the material reflectivity when set (Scenario D). */
  wallReflectivity: z.number().min(0).max(1).nullable().default(null),
});
export type Room = z.infer<typeof Room>;

export const ObstacleKind = z.enum(["table", "sofa", "cabinet", "shelf", "partition", "bed", "desk", "box"]);
export type ObstacleKind = z.infer<typeof ObstacleKind>;

export const Obstacle = z.object({
  id: z.string().min(1),
  kind: ObstacleKind,
  min: Vec3,
  max: Vec3,
  material: Material,
  /** Optional explicit penetration loss in dB, overriding the material default. */
  attenuationDb: z.number().min(0).max(60).nullable().default(null),
});
export type Obstacle = z.infer<typeof Obstacle>;

export const WallSide = z.enum(["south", "east", "north", "west"]);
export type WallSide = z.infer<typeof WallSide>;

export const Opening = z.object({
  id: z.string().min(1),
  kind: z.enum(["door", "window"]),
  wall: WallSide,
  /** Distance along the wall from its start corner to the opening centre, metres. */
  offset: z.number().min(0),
  width: z.number().min(0.3).max(4),
  height: z.number().min(0.3).max(3),
  sill: z.number().min(0).max(2.5).default(0),
});
export type Opening = z.infer<typeof Opening>;

export const SensorRole = z.enum(["tx", "rx", "trx"]);
export type SensorRole = z.infer<typeof SensorRole>;

export const SensorNode = z.object({
  id: z.string().min(1),
  label: z.string().default(""),
  role: SensorRole,
  position: Vec3,
  /** Boresight heading in degrees, counter-clockwise from +x. Rx arrays are perpendicular to boresight. */
  yawDeg: z.number().min(-360).max(360),
  /** Receive antennas in a uniform linear array with half-wavelength spacing. */
  antennas: z.number().int().min(1).max(4).default(3),
  enabled: z.boolean().default(true),
});
export type SensorNode = z.infer<typeof SensorNode>;

export interface LinkDescriptor {
  index: number;
  id: string;
  txId: string;
  rxId: string;
  tx: Vec3;
  rx: Vec3;
  lengthM: number;
  antennas: number;
}
