/**
 * Common TwinCAT 3 / PLCopen standard library function blocks.
 *
 * Each entry carries the function block name, its VAR_INPUT / VAR_OUTPUT
 * signature, and a human-readable description suitable for hover
 * documentation.
 */

export interface FBParam {
  name: string;
  type: string;
  description: string;
}

export interface StandardFB {
  name: string;
  description: string;
  inputs: FBParam[];
  outputs: FBParam[];
}

export const STANDARD_FBS: readonly StandardFB[] = [
  // ── Timer function blocks ────────────────────────────────────────────────
  {
    name: 'TON',
    description:
      'On-delay timer (PLCopen). The output Q goes TRUE after the input IN has been TRUE continuously for the duration PT.',
    inputs: [
      { name: 'IN', type: 'BOOL', description: 'Timer input (start trigger).' },
      { name: 'PT', type: 'TIME', description: 'Preset time (delay duration).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'Output: TRUE when ET ≥ PT.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since IN went TRUE.' },
    ],
  },
  {
    name: 'TOF',
    description:
      'Off-delay timer (PLCopen). The output Q stays TRUE for the duration PT after the input IN goes FALSE.',
    inputs: [
      { name: 'IN', type: 'BOOL', description: 'Timer input; rising edge starts Q, falling edge starts delay.' },
      { name: 'PT', type: 'TIME', description: 'Preset time (delay duration).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'Output: TRUE while IN is TRUE or while elapsed < PT.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since IN went FALSE.' },
    ],
  },
  {
    name: 'TP',
    description:
      'Pulse timer (PLCopen). A rising edge on IN generates a fixed-length pulse of duration PT on Q.',
    inputs: [
      { name: 'IN', type: 'BOOL', description: 'Trigger input; rising edge starts the pulse.' },
      { name: 'PT', type: 'TIME', description: 'Pulse duration.' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'Pulse output: TRUE for PT after rising edge on IN.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since the pulse started.' },
    ],
  },

  // ── Counter function blocks ──────────────────────────────────────────────
  {
    name: 'CTU',
    description:
      'Up-counter (PLCopen). Counts rising edges on CU up to PV. Output Q goes TRUE when CV ≥ PV.',
    inputs: [
      { name: 'CU', type: 'BOOL', description: 'Count up: counted on each rising edge.' },
      { name: 'R', type: 'BOOL', description: 'Reset: sets CV to 0 when TRUE.' },
      { name: 'PV', type: 'INT', description: 'Preset value (upper limit).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE when CV ≥ PV.' },
      { name: 'CV', type: 'INT', description: 'Current count value.' },
    ],
  },
  {
    name: 'CTD',
    description:
      'Down-counter (PLCopen). Loaded with PV on LD; counts down on rising edges on CD. Output Q goes TRUE when CV ≤ 0.',
    inputs: [
      { name: 'CD', type: 'BOOL', description: 'Count down: counted on each rising edge.' },
      { name: 'LD', type: 'BOOL', description: 'Load: sets CV to PV when TRUE.' },
      { name: 'PV', type: 'INT', description: 'Preset value (initial count).' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE when CV ≤ 0.' },
      { name: 'CV', type: 'INT', description: 'Current count value.' },
    ],
  },
  {
    name: 'CTUD',
    description:
      'Up/Down-counter (PLCopen). Counts rising edges on CU up and on CD down. Reset R sets CV to 0; Load LD sets CV to PV.',
    inputs: [
      { name: 'CU', type: 'BOOL', description: 'Count up on rising edge.' },
      { name: 'CD', type: 'BOOL', description: 'Count down on rising edge.' },
      { name: 'R', type: 'BOOL', description: 'Reset: sets CV to 0.' },
      { name: 'LD', type: 'BOOL', description: 'Load: sets CV to PV.' },
      { name: 'PV', type: 'INT', description: 'Preset value.' },
    ],
    outputs: [
      { name: 'QU', type: 'BOOL', description: 'TRUE when CV ≥ PV.' },
      { name: 'QD', type: 'BOOL', description: 'TRUE when CV ≤ 0.' },
      { name: 'CV', type: 'INT', description: 'Current count value.' },
    ],
  },

  // ── Bistable function blocks ─────────────────────────────────────────────
  {
    name: 'RS',
    description:
      'RS bistable (Reset-dominant, PLCopen). Output Q1 is SET by the S input and RESET by the R1 input. When both are TRUE, RESET wins.',
    inputs: [
      { name: 'S', type: 'BOOL', description: 'Set input.' },
      { name: 'R1', type: 'BOOL', description: 'Reset input (dominant).' },
    ],
    outputs: [
      { name: 'Q1', type: 'BOOL', description: 'Bistable output.' },
    ],
  },
  {
    name: 'SR',
    description:
      'SR bistable (Set-dominant, PLCopen). Output Q1 is SET by the S1 input and RESET by the R input. When both are TRUE, SET wins.',
    inputs: [
      { name: 'S1', type: 'BOOL', description: 'Set input (dominant).' },
      { name: 'R', type: 'BOOL', description: 'Reset input.' },
    ],
    outputs: [
      { name: 'Q1', type: 'BOOL', description: 'Bistable output.' },
    ],
  },

  // ── Edge-detection function blocks ───────────────────────────────────────
  {
    name: 'R_TRIG',
    description:
      'Rising-edge detector (PLCopen). Output Q is TRUE for exactly one cycle when input CLK transitions from FALSE to TRUE.',
    inputs: [
      { name: 'CLK', type: 'BOOL', description: 'Signal to detect rising edges on.' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE for one cycle on a rising edge of CLK.' },
    ],
  },
  {
    name: 'F_TRIG',
    description:
      'Falling-edge detector (PLCopen). Output Q is TRUE for exactly one cycle when input CLK transitions from TRUE to FALSE.',
    inputs: [
      { name: 'CLK', type: 'BOOL', description: 'Signal to detect falling edges on.' },
    ],
    outputs: [
      { name: 'Q', type: 'BOOL', description: 'TRUE for one cycle on a falling edge of CLK.' },
    ],
  },
];

/**
 * Look up a standard FB by name (case-insensitive).
 */
export function findStandardFB(name: string): StandardFB | undefined {
  const upper = name.toUpperCase();
  return STANDARD_FBS.find((fb) => fb.name === upper);
}

/**
 * Return hover documentation markdown for a standard FB.
 */
export function standardFBHover(fb: StandardFB): string {
  const inputRows = fb.inputs
    .map((p) => `| \`${p.name}\` | \`${p.type}\` | ${p.description} |`)
    .join('\n');
  const outputRows = fb.outputs
    .map((p) => `| \`${p.name}\` | \`${p.type}\` | ${p.description} |`)
    .join('\n');

  return [
    `**${fb.name}** — ${fb.description}`,
    '',
    '**Inputs**',
    '',
    '| Name | Type | Description |',
    '|------|------|-------------|',
    inputRows,
    '',
    '**Outputs**',
    '',
    '| Name | Type | Description |',
    '|------|------|-------------|',
    outputRows,
  ].join('\n');
}
