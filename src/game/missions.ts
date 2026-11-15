// AI-assisted: written with Claude Code (Anthropic) during NASA Space Apps 2026 — see docs/AI_DISCLOSURE.md
/**
 * The science campaign. Each mission = a question, an action in the world, and a
 * result computed by the same engine as the scanner (never scripted numbers).
 * Success means "you completed a valid analysis" — never "this site is safe".
 */

export type MissionEvent =
  | { type: "interact"; id: string }
  | { type: "record"; id: string }
  | { type: "near"; id: string }
  | { type: "planner" }
  | { type: "choose"; site: "a" | "b" }
  | { type: "slip"; days: number }
  | { type: "orbit" }
  | { type: "land" };

export interface Step {
  text: string;
  target?: string; // world beacon id for the waypoint
  done: (e: MissionEvent) => boolean;
}

export interface Mission {
  id: string;
  num: string;
  title: string;
  brief: string;
  why: string;
  steps: Step[];
}

export const MISSIONS: Mission[] = [
  {
    id: "m1",
    num: "01",
    title: "First Light",
    brief: "Does the outpost get enough direct sunlight?",
    why: "A solar-powered lander lives on sunlight. At the pole the Sun skims the horizon, so a ridge one degree high can switch the power off for days.",
    steps: [
      { text: "Walk to the Solar Monitoring Station — follow the amber path lights", target: "solar", done: (e) => e.type === "interact" && e.id === "solar" },
      { text: "Read the station. Scrub or play time to watch the Sun move, then Record observation", target: "solar", done: (e) => e.type === "record" && e.id === "solar" },
    ],
  },
  {
    id: "m2",
    num: "02",
    title: "Calling Earth",
    brief: "When can the outpost see Earth directly?",
    why: "Without a relay satellite, commands and data travel in a straight line to Earth. If terrain blocks Earth, the lander is on its own.",
    steps: [
      { text: "Go to the Comms Station — the dish is tracking Earth's real direction", target: "comms", done: (e) => e.type === "interact" && e.id === "comms" },
      { text: "Find the next Earth-visibility gap, then Record observation", target: "comms", done: (e) => e.type === "record" && e.id === "comms" },
    ],
  },
  {
    id: "m3",
    num: "03",
    title: "The Shadow Problem",
    brief: "Is a spot just down the slope as good as the outpost?",
    why: "Sites a few hundred metres apart can live in different worlds: a lower spot sees a higher horizon, and the Sun only clears it some of the time.",
    steps: [
      { text: "Lope (Shift) to Survey point S-1 — follow the light beam", target: "survey", done: (e) => e.type === "interact" && e.id === "survey" },
      { text: "Compare real terrain with a smooth Moon, then Record observation", target: "survey", done: (e) => e.type === "record" && e.id === "survey" },
    ],
  },
  {
    id: "m4",
    num: "04",
    title: "Choose the Landing Site",
    brief: "Which candidate site better serves a solar-powered lander?",
    why: "Requirement: the lander must both make power (Sun) and talk to Earth. Pick the site where both are true for the larger share of the window.",
    steps: [
      { text: "Access Mission Control (E at its door) — or press P", target: "control", done: (e) => e.type === "planner" },
      { text: "Compare Athena and Odysseus, then submit your choice in the planner", done: (e) => e.type === "choose" },
    ],
  },
  {
    id: "m5",
    num: "05",
    title: "The Delay",
    brief: "The launch slips by a week. Does your answer still hold?",
    why: "Polar lighting changes day by day. A schedule slip can turn a good site into a dark one.",
    steps: [{ text: "In the planner, move the schedule slip to +7 days and read the verdict", done: (e) => e.type === "slip" && e.days === 7 }],
  },
];

export class Campaign {
  mi = 0;
  si = 0;
  active = false;
  done = new Set<string>();

  constructor(private onChange: () => void, private onMissionComplete: (m: Mission) => void) {}

  get mission(): Mission | null {
    return this.active ? (MISSIONS[this.mi] ?? null) : null;
  }

  get step(): Step | null {
    return this.mission?.steps[this.si] ?? null;
  }

  start(i = 0): void {
    this.active = true;
    this.mi = i;
    this.si = 0;
    this.onChange();
  }

  stop(): void {
    this.active = false;
    this.onChange();
  }

  emit(e: MissionEvent): void {
    const st = this.step;
    if (!st || !st.done(e)) return;
    const m = this.mission as Mission;
    this.si++;
    if (this.si >= m.steps.length) {
      this.done.add(m.id);
      this.onMissionComplete(m);
    } else this.onChange();
  }

  next(): void {
    if (this.mi + 1 < MISSIONS.length) {
      this.mi++;
      this.si = 0;
      this.active = true;
    } else this.active = false;
    this.onChange();
  }
}
