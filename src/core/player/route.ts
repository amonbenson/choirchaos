import type { Tick } from "../midi/types";
import { findRecordedPasses, type RecordedPass } from "../models/recording";
import { type Section, UNTIL_RELEASED, type VampOut } from "../models/sections";
import { findBeatAt, findPositionAt, getBeatTick, getStartTick, type ResolvedTimeline, type TimelinePosition } from "./timeline";
import type { PlayerSectionState } from "./types";

/** A recorded pass with the ticks it plays, `end` exclusive. */
export type PassRange = RecordedPass & { start: Tick; end: Tick };

export type RouteSection = {
  /** Index into `song.getSections()`. */
  index: number;
  section: Section;
  passes: readonly PassRange[];
};

/** The section being played, with its 1-based desired pass. Cuts never have a state. */
export type RouteState = { section: number; pass: number; released: boolean };

/** A discontinuity: at `at`, playback continues at `to` with the state `next`. `to === at` only changes the state. */
export type RouteJump = { at: Tick; to: Tick; next: RouteState | undefined };

export type VocalRole = "entering" | "repeating" | "exiting";

export type RouteOptions = { vampsEnabled: boolean };

type LineKind = "bar" | "beat";

const EARLY_EXIT_LINES: Record<VampOut, LineKind | undefined> = { onEnd: undefined, anyBar: "bar", anyBeat: "beat" };

/**
 * Decides where playback goes next through the song's sections. Pure: the engine owns the state and
 * passes it in, so seeking only needs `stateAt()`.
 */
export default class Route {
  private readonly sections: RouteSection[];

  constructor(private readonly timeline: ResolvedTimeline, sections: readonly Section[], options: RouteOptions) {
    // A disabled vamp plays as recorded, which is the same as having no section there.
    this.sections = sections.flatMap((section, index) => {
      if (section.kind === "vamp" && !options.vampsEnabled) {
        return [];
      }

      const passes = findRecordedPasses(timeline, section).map(pass => this.toPassRange(section, pass));
      return passes.length > 0 ? [{ index, section, passes }] : [];
    });
  }

  getSections(): readonly RouteSection[] {
    return this.sections;
  }

  /**
   * The state of a fresh visit to `tick`: inside recorded pass k means desired pass k. When several passes
   * are recorded, the last one is the last pass, and passes beyond the total count as the last pass.
   */
  stateAt(tick: Tick): RouteState | undefined {
    for (const routeSection of this.sections) {
      const k = this.findPassIndex(routeSection, tick);
      if (k === -1 || routeSection.section.kind === "cut") {
        continue;
      }

      return { section: routeSection.index, pass: this.getPassAt(routeSection, k), released: false };
    }

    return undefined;
  }

  nextJump(state: RouteState | undefined, tick: Tick): RouteJump | undefined {
    const routeSection = state && this.findSection(state.section);
    if (!state || !routeSection) {
      return this.findNextEntry(tick);
    }

    const k = this.findPassIndex(routeSection, tick);
    if (k === -1) {
      return { at: tick, to: tick, next: this.stateAt(tick) };
    }

    return this.findJumpInSection(routeSection, state, k, tick);
  }

  getVocalRole(state: RouteState | undefined, tick: Tick): VocalRole | undefined {
    const routeSection = state && this.findSection(state.section);
    if (!state || !routeSection) {
      return undefined;
    }

    const k = this.findPassIndex(routeSection, tick);
    if (k === -1) {
      return undefined;
    }

    const role = this.getRecordedRole(routeSection, k, tick);
    if (role === "entering" && state.pass !== 1) {
      return "repeating";
    }

    if (role === "exiting" && !this.isLast(routeSection, state.pass, state.released)) {
      return "repeating";
    }

    return role;
  }

  muteVocals(state: RouteState | undefined, tick: Tick): boolean {
    const section = state && this.findSection(state.section)?.section;
    if (section?.kind !== "vamp") {
      return false;
    }

    switch (section.vocals) {
      case "all": return false;
      case "first": return this.getVocalRole(state, tick) !== "entering";
      case "last": return this.getVocalRole(state, tick) !== "exiting";
      case "split": return this.getVocalRole(state, tick) === "repeating";
    }
  }

  /** The next tick in the current pass where muting changes although the state stays, if any. */
  findMuteChange(state: RouteState | undefined, tick: Tick): Tick | undefined {
    const routeSection = state && this.findSection(state.section);
    if (!routeSection || routeSection.passes.length !== 1 || this.findPassIndex(routeSection, tick) === -1) {
      return undefined;
    }

    // A single recorded pass changes from entering to exiting material at its midpoint.
    const pass = routeSection.passes[0]!;
    const midpoint = (pass.start + pass.end) / 2;
    if (tick >= midpoint || this.muteVocals(state, tick) === this.muteVocals(state, midpoint)) {
      return undefined;
    }

    return midpoint;
  }

  getSectionState(state: RouteState | undefined): PlayerSectionState | undefined {
    const routeSection = state && this.findSection(state.section);
    if (!state || !routeSection) {
      return undefined;
    }

    return {
      section: routeSection.index,
      kind: routeSection.section.kind,
      pass: state.pass,
      passes: state.released ? state.pass : this.getTotalPasses(routeSection),
      recordedPasses: routeSection.passes.length,
      released: state.released,
    };
  }

  /** The tick at the same measure offset, beat and fraction of a beat in another pass. */
  mapTick(tick: Tick, from: PassRange, to: PassRange): Tick {
    const source = findPositionAt(this.timeline, tick)!;
    const target = this.timeline[Math.min(to.first + source.position - from.first, to.last)]!;
    const beat = findBeatAt(source, tick);
    const fraction = this.getBeatFraction(source, beat, tick);
    const targetBeat = Math.min(beat, target.beats - 1);
    const targetStart = getBeatTick(target, targetBeat);
    return targetStart + fraction * (getBeatTick(target, targetBeat + 1) - targetStart);
  }

  private getBeatFraction(position: TimelinePosition, beat: number, tick: Tick): number {
    const start = getBeatTick(position, beat);
    const end = getBeatTick(position, beat + 1);
    return end > start ? (tick - start) / (end - start) : 0;
  }

  private toPassRange(section: Section, pass: RecordedPass): PassRange {
    return {
      ...pass,
      start: getBeatTick(this.timeline[pass.first]!, section.from.beat),
      end: getBeatTick(this.timeline[pass.last]!, section.to.beat + 1),
    };
  }

  private findSection(index: number): RouteSection | undefined {
    return this.sections.find(routeSection => routeSection.index === index);
  }

  private findPassIndex(routeSection: RouteSection, tick: Tick): number {
    return routeSection.passes.findIndex(pass => pass.start <= tick && tick < pass.end);
  }

  /** Total passes to play, or undefined while a vamp runs until released. */
  private getTotalPasses({ section }: RouteSection): number | undefined {
    switch (section.kind) {
      case "cut": return 0;
      case "repeat": return section.passes;
      case "vamp": return section.passes === UNTIL_RELEASED ? undefined : section.passes;
    }
  }

  private isLast(routeSection: RouteSection, pass: number, released: boolean): boolean {
    const total = this.getTotalPasses(routeSection);
    return released || (total !== undefined && pass >= total);
  }

  private getPassAt(routeSection: RouteSection, k: number): number {
    const total = this.getTotalPasses(routeSection);
    const recorded = routeSection.passes.length;
    if (total === undefined || recorded === 1) {
      return k + 1;
    }

    return k === recorded - 1 ? total : Math.min(k + 1, total);
  }

  /** The 0-based recorded pass that plays a desired pass: the last pass plays the last recording, extra passes repeat the one before it. */
  private getRecordedPassIndex(routeSection: RouteSection, pass: number, last: boolean): number {
    const recorded = routeSection.passes.length;
    if (last) {
      return recorded - 1;
    }

    if (pass < recorded) {
      return pass - 1;
    }

    return Math.max(1, recorded - 1) - 1;
  }

  private getRecordedRole(routeSection: RouteSection, k: number, tick: Tick): VocalRole {
    const passes = routeSection.passes;
    if (passes.length === 1) {
      const midpoint = (passes[0]!.start + passes[0]!.end) / 2;
      return tick < midpoint ? "entering" : "exiting";
    }

    if (k === 0) {
      return "entering";
    }

    return k === passes.length - 1 ? "exiting" : "repeating";
  }

  private findNextEntry(tick: Tick): RouteJump | undefined {
    let next: RouteJump | undefined;
    for (const routeSection of this.sections) {
      const first = routeSection.passes[0]!;
      if (first.start < tick || (next && next.at <= first.start)) {
        continue;
      }

      next = this.enter(routeSection);
    }

    return next;
  }

  private enter(routeSection: RouteSection): RouteJump {
    const first = routeSection.passes[0]!;
    if (routeSection.section.kind === "cut") {
      return this.exit(first.start, routeSection.passes.at(-1)!.end);
    }

    return { at: first.start, to: first.start, next: { section: routeSection.index, pass: 1, released: false } };
  }

  private exit(at: Tick, to: Tick): RouteJump {
    return { at, to, next: this.stateAt(to) };
  }

  /** Which line a released vamp may leave at before its end, if any. */
  private getEarlyExitLine({ section }: RouteSection, state: RouteState): LineKind | undefined {
    if (section.kind !== "vamp" || !state.released) {
      return undefined;
    }

    return EARLY_EXIT_LINES[section.out];
  }

  private findJumpInSection(routeSection: RouteSection, state: RouteState, k: number, tick: Tick): RouteJump {
    const passes = routeSection.passes;
    const current = passes[k]!;
    const lastRecorded = passes.at(-1)!;
    const isLastRecorded = k === passes.length - 1;

    if (!this.isLast(routeSection, state.pass, state.released)) {
      const pass = state.pass + 1;
      const recorded = this.getRecordedPassIndex(routeSection, pass, this.isLast(routeSection, pass, false));
      return { at: current.end, to: passes[recorded]!.start, next: { ...state, pass } };
    }

    const exitLine = this.getEarlyExitLine(routeSection, state);
    if (exitLine) {
      return this.exit(this.findLineBetween(tick, current.end, exitLine) ?? current.end, lastRecorded.end);
    }

    if (isLastRecorded) {
      return this.exit(current.end, current.end);
    }

    return this.retarget(state, tick, current, lastRecorded);
  }

  /** The last pass while another recording plays: jump at a barline up to the midpoint, otherwise finish it and play the last recording in full. */
  private retarget(state: RouteState, tick: Tick, current: PassRange, lastRecorded: PassRange): RouteJump {
    const midpoint = (current.start + current.end) / 2;
    const barline = tick <= midpoint ? this.findBarline(Math.max(tick, current.start), midpoint) : undefined;
    if (barline !== undefined) {
      return { at: barline, to: this.mapTick(barline, current, lastRecorded), next: state };
    }

    return { at: current.end, to: lastRecorded.start, next: state };
  }

  /** The first barline in `[from, to]`. */
  private findBarline(from: Tick, to: Tick): Tick | undefined {
    for (let p = findPositionAt(this.timeline, from)!.position; p < this.timeline.length; p++) {
      const start = getStartTick(this.timeline[p]!);
      if (start > to) {
        return undefined;
      }

      if (start >= from) {
        return start;
      }
    }

    return undefined;
  }

  /** The first barline or beat strictly between `after` and `before`. */
  private findLineBetween(after: Tick, before: Tick, kind: LineKind): Tick | undefined {
    for (let p = findPositionAt(this.timeline, after)!.position; p < this.timeline.length; p++) {
      const position = this.timeline[p]!;
      const ticks = kind === "bar" ? [getStartTick(position)] : position.beatTicks;
      const line = ticks.find(tick => tick > after);
      if (line !== undefined) {
        return line < before ? line : undefined;
      }
    }

    return undefined;
  }
}
