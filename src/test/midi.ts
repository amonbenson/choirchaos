export type TestNote = { tick: number; duration: number; pitch: number; velocity?: number };
export type TestTrack = { name: string; channel: number; notes: TestNote[] };

function varLen(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x4000) return [(n >> 7) | 0x80, n & 0x7f];
  if (n < 0x200000) return [(n >> 14) | 0x80, ((n >> 7) & 0x7f) | 0x80, n & 0x7f];
  return [(n >> 21) | 0x80, ((n >> 14) & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n & 0x7f];
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function be16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function metaEvent(delta: number, type: number, data: number[]): number[] {
  return [...varLen(delta), 0xff, type, ...varLen(data.length), ...data];
}

function endOfTrack(): number[] {
  return metaEvent(0, 0x2f, []);
}

function trackNameEvent(name: string): number[] {
  return metaEvent(0, 0x03, [...name].map(c => c.charCodeAt(0)));
}

function chunk(id: string, data: number[]): number[] {
  return [[...id].map(c => c.charCodeAt(0)), be32(data.length), data].flat(2);
}

/**
 * Builds a standard MIDI format-1 ArrayBuffer from a set of named tracks and note data.
 * Track 0 is an empty tempo track. Subsequent tracks carry the provided note events.
 */
export function buildMidiBuffer(ppqn: number, tracks: TestTrack[]): ArrayBuffer {
  const header = chunk("MThd", [
    ...be16(1),             // format 1
    ...be16(tracks.length + 1), // ntracks (named tracks + tempo track)
    ...be16(ppqn),
  ]);

  const tempoTrack = chunk("MTrk", endOfTrack());

  const namedTracks = tracks.map(({ name, channel, notes }) => {
    type Ev = { tick: number; bytes: number[] };
    const evs: Ev[] = [];

    for (const n of notes) {
      const vel = n.velocity ?? 80;
      evs.push({ tick: n.tick, bytes: [0x90 | channel, n.pitch, vel] });
      evs.push({ tick: n.tick + n.duration, bytes: [0x80 | channel, n.pitch, 0] });
    }
    evs.sort((a, b) => a.tick - b.tick);

    const data: number[] = trackNameEvent(name);
    let cur = 0;
    for (const ev of evs) {
      data.push(...varLen(ev.tick - cur), ...ev.bytes);
      cur = ev.tick;
    }
    data.push(...endOfTrack());

    return chunk("MTrk", data);
  });

  const bytes = [...header, ...tempoTrack, ...namedTracks.flat()];
  return new Uint8Array(bytes).buffer;
}
