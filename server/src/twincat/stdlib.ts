/**
 * Thin backward-compatibility wrapper over libraryRegistry.
 *
 * All Tc2_Standard function block data now lives in libraryRegistry.ts.
 * This module re-exports the types and helpers that existing handlers
 * already import from this path.
 */

export type { FBParam } from './libraryRegistry';
import { getLibraryFBs } from './libraryRegistry';
import type { LibraryFB } from './libraryRegistry';

/** Backward-compatible alias: LibraryFB without the namespace field. */
export type StandardFB = LibraryFB;

/** All Tc2_Standard function blocks (sourced from libraryRegistry). */
export const STANDARD_FBS: readonly StandardFB[] = getLibraryFBs('Tc2_Standard');

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
