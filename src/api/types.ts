/**
 * Shared types for the input pipeline.
 *
 * Patch coordinates use (row, col) with origin at the top-left.
 * For DeiT-Tiny on 224x224 images, the grid is 14x14, so row/col
 * range over [0, 14).
 */

export interface Patch {
  /** 0..gridSize-1, top to bottom */
  row: number
  /** 0..gridSize-1, left to right */
  col: number
}

/** Discrete event emitted by MouseToPatch when the active patch changes. */
export type PatchEvent =
  | { kind: 'enter'; patch: Patch }
  | { kind: 'leave' }

/** State exposed by DwellDetector. Drives both UI feedback and the future backend trigger. */
export type GazeStatus =
  | { kind: 'off_canvas' }
  | { kind: 'scanning'; patch: Patch; enteredAt: number }
  | { kind: 'dwelling'; patch: Patch; firedAt: number }