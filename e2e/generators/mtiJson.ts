import type { MTIMidiJson } from "../../src/core/scripts/jsonTypes/mti";
import { midiChannelForPart } from "./midi";
import { PPQN, terminalMeasureNumber, type Timeline } from "./score/timeline";

type MtiEvent = MTIMidiJson["score"]["events"][number];

const MICROSECONDS_PER_MINUTE = 60_000_000;

/**
 * The beat map that accompanies a MIDI file in MIDI mode. It ends with beat 1 of a terminal bar
 * after the last real bar, which is how the player learns the length of the last bar.
 */
export function toMtiJson(timeline: Timeline): MTIMidiJson {
  const events: MtiEvent[] = [];
  let previousSignature = "";

  for (const measure of timeline.measures) {
    const signature = `${measure.beats}/${measure.timeSignature.beatType}`;

    if (measure.tempoChange !== undefined) {
      events.push({
        tickcount: measure.startTick,
        type: "TEMPO",
        value: { bpm: measure.tempoChange, ticksPerQuarter: Math.round(MICROSECONDS_PER_MINUTE / measure.tempoChange) },
      });
    }

    if (signature !== previousSignature) {
      events.push({
        tickcount: measure.startTick,
        type: "TIMESIG",
        value: { numerator: measure.beats, denominator: Math.log2(measure.timeSignature.beatType), metroCount: 24, _32nds: 8 },
      });
      previousSignature = signature;
    }

    for (let beat = 0; beat < measure.beats; beat++) {
      events.push({
        tickcount: measure.startTick + beat * measure.ticksPerBeat,
        type: "BEAT",
        value: { meas: measure.number, beat: beat + 1, tick: 0 },
      });
    }
  }

  events.push({ tickcount: timeline.durationTicks, type: "BEAT", value: { meas: terminalMeasureNumber(timeline), beat: 1, tick: 0 } });

  return {
    score: {
      title: timeline.spec.title,
      ppqn: PPQN,
      trackNames: {
        cnt: timeline.spec.parts.length,
        track: timeline.spec.parts.map(part => ({ name: part.name, channel: midiChannelForPart(timeline, part.id) })),
      },
      jumpTable: { cnt: 0, entries: [] },
      events,
    },
  };
}
