import { type MidiEvent, writeMidi } from "midi-file";

import { eventStartTick, PPQN, TICKS_PER_UNIT, type Timeline } from "./score/timeline";

const PERCUSSION_CHANNEL = 9;
const MICROSECONDS_PER_MINUTE = 60_000_000;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type TimedEvent = { tick: number; order: number; event: DistributiveOmit<MidiEvent, "deltaTime"> };

/** Assigns channels in part order and skips the General MIDI percussion channel for melodic parts. */
export function midiChannelForPart(timeline: Timeline, partId: string): number {
  const melodicParts = timeline.spec.parts.filter(part => part.classification !== "Percussion");
  const part = timeline.spec.parts.find(p => p.id === partId)!;

  if (part.classification === "Percussion") {
    return PERCUSSION_CHANNEL;
  }

  const index = melodicParts.indexOf(part);
  return index >= PERCUSSION_CHANNEL ? index + 1 : index;
}

function toTrack(events: TimedEvent[], endTick: number): MidiEvent[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: MidiEvent[] = [];
  let previousTick = 0;

  for (const { tick, event } of sorted) {
    track.push({ ...event, deltaTime: tick - previousTick } as MidiEvent);
    previousTick = tick;
  }

  track.push({ type: "endOfTrack", meta: true, deltaTime: Math.max(0, endTick - previousTick) });
  return track;
}

function conductorTrack(timeline: Timeline): MidiEvent[] {
  const events: TimedEvent[] = [{ tick: 0, order: 0, event: { type: "trackName", meta: true, text: timeline.spec.title } }];
  let previousSignature = "";

  for (const measure of timeline.measures) {
    const signature = `${measure.beats}/${measure.timeSignature.beatType}`;
    if (signature !== previousSignature) {
      events.push({
        tick: measure.startTick,
        order: 1,
        event: {
          type: "timeSignature",
          meta: true,
          numerator: measure.beats,
          denominator: measure.timeSignature.beatType,
          metronome: 24,
          thirtyseconds: 8,
        },
      });
      previousSignature = signature;
    }
  }

  for (const change of timeline.tempoChanges) {
    events.push({
      tick: change.tick,
      order: 2,
      event: { type: "setTempo", meta: true, microsecondsPerBeat: Math.round(MICROSECONDS_PER_MINUTE / change.bpm) },
    });
  }

  return toTrack(events, timeline.durationTicks);
}

function partTrack(timeline: Timeline, partId: string): MidiEvent[] {
  const part = timeline.spec.parts.find(p => p.id === partId)!;
  const channel = midiChannelForPart(timeline, partId);
  const events: TimedEvent[] = [
    { tick: 0, order: 0, event: { type: "trackName", meta: true, text: part.name } },
    { tick: 0, order: 1, event: { type: "programChange", channel, programNumber: part.program } },
  ];

  for (const note of timeline.events.filter(event => event.partId === partId && event.pitches.length > 0)) {
    const start = eventStartTick(timeline, note);
    const end = start + note.durationUnits * TICKS_PER_UNIT;

    for (const pitch of note.pitches) {
      // Note-offs sort before note-ons at the same tick, so repeated pitches retrigger cleanly.
      events.push({ tick: start, order: 3, event: { type: "noteOn", channel, noteNumber: pitch, velocity: note.velocity } });
      events.push({ tick: end, order: 2, event: { type: "noteOff", channel, noteNumber: pitch, velocity: 0 } });
    }
  }

  return toTrack(events, timeline.durationTicks);
}

/**
 * Format 1 MIDI file with a conductor track (tempo, metre) and one named track per part. The
 * player looks tracks up by name, so the names equal the part names used as song track titles.
 */
export function toMidiFile(timeline: Timeline): Uint8Array<ArrayBuffer> {
  const tracks = [conductorTrack(timeline), ...timeline.spec.parts.map(part => partTrack(timeline, part.id))];

  return Uint8Array.from(writeMidi({
    header: { format: 1, numTracks: tracks.length, ticksPerBeat: PPQN },
    tracks,
  }));
}
