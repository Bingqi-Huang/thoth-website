export type System = "thoth" | "plexil" | "europa";

export interface RunRef { id: string; system: System; label: string | null; duration: number; success: boolean | null }

export interface Scenario {
  id: string; group: "reference" | "contingency" | "sequential" | "identity"; family: string;
  title: string; condition: string; keywords: string; runs: RunRef[];
}

export interface Unit { name: string; load: string; crit: string; breaker: string; energized: boolean; trip: string | null }

export interface Ev {
  t: number; k: string;
  [key: string]: any;
}

export interface Run {
  id: string; system: System; scenario: string;
  video: { t0: number; t1: number; frames: number };
  track: [number, number, number, number, string | null][];
  events: Ev[];
  outcome?: { success: boolean; reason: string | null; elapsed: number };
  cams?: { t0: number };
}

export const SYSTEM_NAME: Record<System, string> = { thoth: "Thoth", plexil: "PLEXIL", europa: "EUROPA→PLEXIL" };
