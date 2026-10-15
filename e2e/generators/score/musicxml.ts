import type { Timeline, TimelineEvent, TimelineMeasure } from "./timeline";
import { UNITS_PER_QUARTER } from "./timeline";
import type { Clef, PartSpec, ScoreSpec } from "./types";

// A4 portrait at 7 mm staff height (40 tenths). The app assumes A4 page proportions.
const MILLIMETERS_PER_STAFF = 7;
const TENTHS_PER_STAFF = 40;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 12;

const NOTE_TYPES: Record<number, { type: string; dotted: boolean }> = {
  1: { type: "eighth", dotted: false },
  2: { type: "quarter", dotted: false },
  3: { type: "quarter", dotted: true },
  4: { type: "half", dotted: false },
  6: { type: "half", dotted: true },
  8: { type: "whole", dotted: false },
};

const SHARP_SPELLING: [string, number][] = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
const FLAT_SPELLING: [string, number][] = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];

const CLEFS: Record<Clef, string> = {
  treble: "<sign>G</sign><line>2</line>",
  treble8vb: "<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>",
  bass: "<sign>F</sign><line>4</line>",
};

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mmToTenths(mm: number): number {
  return Math.round((mm * TENTHS_PER_STAFF) / MILLIMETERS_PER_STAFF);
}

function partXmlId(index: number): string {
  return `P${index + 1}`;
}

function voiceForStaff(staff: number): number {
  return staff * 4 + 1;
}

function pitchXml(pitch: number, keyFifths: number): string {
  const [step, alter] = (keyFifths < 0 ? FLAT_SPELLING : SHARP_SPELLING)[pitch % 12]!;
  const octave = Math.floor(pitch / 12) - 1;
  const alterXml = alter === 0 ? "" : `<alter>${alter}</alter>`;
  return `<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>`;
}

function defaultsXml(): string {
  const margin = mmToTenths(PAGE_MARGIN_MM);
  const margins = `<left-margin>${margin}</left-margin><right-margin>${margin}</right-margin><top-margin>${margin}</top-margin><bottom-margin>${margin}</bottom-margin>`;

  return [
    "<defaults>",
    `<scaling><millimeters>${MILLIMETERS_PER_STAFF}</millimeters><tenths>${TENTHS_PER_STAFF}</tenths></scaling>`,
    `<page-layout><page-height>${mmToTenths(A4_HEIGHT_MM)}</page-height><page-width>${mmToTenths(A4_WIDTH_MM)}</page-width>`,
    `<page-margins type="both">${margins}</page-margins></page-layout>`,
    "</defaults>",
  ].join("");
}

function creditsXml(spec: ScoreSpec): string {
  const centerX = mmToTenths(A4_WIDTH_MM / 2);
  const titleY = mmToTenths(A4_HEIGHT_MM - PAGE_MARGIN_MM - 8);
  const subtitleY = mmToTenths(A4_HEIGHT_MM - PAGE_MARGIN_MM - 16);

  return [
    `<credit page="1"><credit-type>title</credit-type><credit-words default-x="${centerX}" default-y="${titleY}" font-size="20" justify="center" valign="top">${escapeXml(spec.title)}</credit-words></credit>`,
    `<credit page="1"><credit-type>subtitle</credit-type><credit-words default-x="${centerX}" default-y="${subtitleY}" font-size="12" justify="center" valign="top">No. ${escapeXml(spec.number)}</credit-words></credit>`,
  ].join("");
}

function partListXml(spec: ScoreSpec): string {
  const vocalIndices = spec.parts.flatMap((part, index) => (part.classification === "Vocal" ? [index] : []));
  const items: string[] = [];

  spec.parts.forEach((part, index) => {
    if (vocalIndices.length > 1 && index === vocalIndices[0]) {
      items.push("<part-group type=\"start\" number=\"1\"><group-symbol>bracket</group-symbol><group-barline>yes</group-barline></part-group>");
    }

    const id = partXmlId(index);
    items.push([
      `<score-part id="${id}">`,
      `<part-name>${escapeXml(part.name)}</part-name>`,
      `<part-abbreviation>${escapeXml(part.abbreviation)}</part-abbreviation>`,
      `<score-instrument id="${id}-I1"><instrument-name>${escapeXml(part.name)}</instrument-name></score-instrument>`,
      `<midi-instrument id="${id}-I1"><midi-channel>${index + 1}</midi-channel><midi-program>${part.program + 1}</midi-program></midi-instrument>`,
      "</score-part>",
    ].join(""));

    if (vocalIndices.length > 1 && index === vocalIndices[vocalIndices.length - 1]) {
      items.push("<part-group type=\"stop\" number=\"1\"/>");
    }
  });

  return `<part-list>${items.join("")}</part-list>`;
}

function attributesXml(spec: ScoreSpec, part: PartSpec, measure: TimelineMeasure): string {
  const isFirst = measure.index === 0;
  if (!isFirst && !measure.showTimeSignature) {
    return "";
  }

  const time = `<time><beats>${measure.timeSignature.beats}</beats><beat-type>${measure.timeSignature.beatType}</beat-type></time>`;
  if (!isFirst) {
    return `<attributes>${time}</attributes>`;
  }

  const staves = part.clefs.length > 1 ? `<staves>${part.clefs.length}</staves>` : "";
  const clefs = part.clefs.map((clef, staff) => `<clef number="${staff + 1}">${CLEFS[clef]}</clef>`).join("");
  return `<attributes><divisions>${UNITS_PER_QUARTER}</divisions><key><fifths>${spec.keyFifths}</fifths></key>${time}${staves}${clefs}</attributes>`;
}

function directionXml(content: string, sound = ""): string {
  return `<direction placement="above"><direction-type>${content}</direction-type>${sound}</direction>`;
}

/** System-wide markings are written into the first part only, which is where MuseScore expects them. */
function systemMarkingsXml(measure: TimelineMeasure): string {
  const markings: string[] = [];

  if (measure.rehearsalMark) {
    markings.push(directionXml(`<rehearsal enclosure="square">${escapeXml(measure.rehearsalMark)}</rehearsal>`));
  }

  if (measure.tempoChange !== undefined) {
    const words = measure.tempoText
      ? [`<direction-type><words font-weight="bold">${escapeXml(measure.tempoText)}</words></direction-type>`]
      : [];
    const metronome = `<direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>${measure.tempoChange}</per-minute></metronome></direction-type>`;
    markings.push(`<direction placement="above">${[...words, metronome].join("")}<sound tempo="${measure.tempoChange}"/></direction>`);
  }

  if (measure.vampStart) {
    const label = measure.vampStart.iterations > 0 ? `Vamp (${measure.vampStart.iterations}x)` : "Vamp";
    markings.push(directionXml(`<words enclosure="rectangle">${label}</words>`));
  }

  return markings.join("");
}

function printXml(measure: TimelineMeasure): string {
  if (measure.pageBreak) {
    return "<print new-page=\"yes\"/>";
  }

  return measure.systemBreak ? "<print new-system=\"yes\"/>" : "";
}

function noteXml(event: TimelineEvent, spec: ScoreSpec, isMultiStaff: boolean): string {
  const staff = isMultiStaff ? `<staff>${event.staff + 1}</staff>` : "";
  const voice = `<voice>${voiceForStaff(event.staff)}</voice>`;

  if (event.isMeasureRest) {
    return `<note><rest measure="yes"/><duration>${event.durationUnits}</duration>${voice}${staff}</note>`;
  }

  const noteType = NOTE_TYPES[event.durationUnits];
  if (!noteType) {
    throw new Error(`Duration of ${event.durationUnits} eighths has no single note value.`);
  }

  const typeXml = `<type>${noteType.type}</type>${noteType.dotted ? "<dot/>" : ""}`;
  const lyric = event.lyric ? `<lyric number="1"><syllabic>single</syllabic><text>${escapeXml(event.lyric)}</text></lyric>` : "";

  return event.pitches.map((pitch, index) => [
    "<note>",
    index > 0 ? "<chord/>" : "",
    pitchXml(pitch, spec.keyFifths),
    `<duration>${event.durationUnits}</duration>`,
    voice,
    typeXml,
    staff,
    index === 0 ? lyric : "",
    "</note>",
  ].join("")).join("");
}

function barlinesXml(measure: TimelineMeasure): { left: string; right: string } {
  const left = measure.vampStart
    ? "<barline location=\"left\"><bar-style>heavy-light</bar-style><repeat direction=\"forward\"/></barline>"
    : "";

  if (measure.vampEnd) {
    const times = measure.vampEnd.iterations > 0 ? ` times="${measure.vampEnd.iterations}"` : "";
    return { left, right: `<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"${times}/></barline>` };
  }

  if (measure.isLast) {
    return { left, right: "<barline location=\"right\"><bar-style>light-heavy</bar-style></barline>" };
  }

  return { left, right: "" };
}

function measureXml(timeline: Timeline, part: PartSpec, partIndex: number, measure: TimelineMeasure, events: TimelineEvent[]): string {
  const { spec } = timeline;
  const isMultiStaff = part.clefs.length > 1;
  const implicit = measure.isPickup || measure.isInserted ? " implicit=\"yes\"" : "";
  const barlines = barlinesXml(measure);

  const staffContents = part.clefs.map((_, staff) => events
    .filter(event => event.staff === staff)
    .map(event => noteXml(event, spec, isMultiStaff))
    .join(""));

  const backup = `<backup><duration>${measure.lengthUnits}</duration></backup>`;

  return [
    `<measure number="${escapeXml(measure.number)}"${implicit}>`,
    printXml(measure),
    barlines.left,
    attributesXml(spec, part, measure),
    partIndex === 0 ? systemMarkingsXml(measure) : "",
    staffContents.join(backup),
    barlines.right,
    "</measure>",
  ].join("");
}

/**
 * Writes a MusicXML 4.0 score that MuseScore turns into a conductor-style PDF. Bar numbers are
 * written as the app's measure numbering; pickup and inserted bars are marked implicit so that
 * MuseScore's own bar count matches the regular numbers.
 */
export function toMusicXml(timeline: Timeline): string {
  const { spec } = timeline;
  const eventsByPartAndMeasure = new Map<string, TimelineEvent[]>();

  for (const event of timeline.events) {
    const key = `${event.partId}/${event.measureIndex}`;
    eventsByPartAndMeasure.set(key, [...(eventsByPartAndMeasure.get(key) ?? []), event]);
  }

  const parts = spec.parts.map((part, partIndex) => {
    const measures = timeline.measures.map(measure =>
      measureXml(timeline, part, partIndex, measure, eventsByPartAndMeasure.get(`${part.id}/${measure.index}`) ?? []));
    return `<part id="${partXmlId(partIndex)}">${measures.join("\n")}</part>`;
  });

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE score-partwise PUBLIC \"-//Recordare//DTD MusicXML 4.0 Partwise//EN\" \"http://www.musicxml.org/dtds/partwise.dtd\">",
    "<score-partwise version=\"4.0\">",
    `<work><work-number>${escapeXml(spec.number)}</work-number><work-title>${escapeXml(spec.title)}</work-title></work>`,
    `<movement-number>${escapeXml(spec.number)}</movement-number>`,
    "<identification><encoding><software>choirchaos e2e score generator</software></encoding></identification>",
    defaultsXml(),
    creditsXml(spec),
    partListXml(spec),
    ...parts,
    "</score-partwise>",
    "",
  ].join("\n");
}

export const PAGE_SIZE_MM = Object.freeze({ width: A4_WIDTH_MM, height: A4_HEIGHT_MM });
