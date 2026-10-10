/** Values exposed to the solver by an instrumented interpreter run. */
export type ProbeValue = number | boolean | string | null | (number | boolean | string | null | undefined)[];

export interface ProbeState {
  blankId: string;
  variables: Record<string, ProbeValue>;
}

/** The callback supplies the value of a solver-only expression hole. */
export type ProbeHandler = (state: ProbeState) => number | boolean;

export const PROBE_PREFIX = '__hkoi_solver_probe_';

export function probeName(blankId: string): string {
  return `${PROBE_PREFIX}${blankId}`;
}
