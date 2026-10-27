import { describe, expect, it } from "vitest";

import {
  changesTiming,
  deserializeLayers,
  getChangedFields,
  planMeasureEdit,
  serializeLayers,
  type SongLayers,
  sortReferences,
  validateLayers,
} from "./layers";
import Measure, { createEmptyMeasureEdit, type MeasureEdit } from "./measure";

const LAYOUT = { page: 0, x: 0.1, y: 0.2, width: 0.1, height: 0.1 };

// Measures "1" to "4" played straight through, with a sync point, a marker and a cut on "3".
function makeLayers(): SongLayers {
  return {
    measures: [new Measure("m1", "1", 4, LAYOUT), new Measure("m2", "2", 4), new Measure("m3", "3", 4), new Measure("m4", "4", 4)],
    unnumberedBoxes: [],
    spans: [{ from: "m1", to: "m4" }],
    warpMarkers: [{ measure: "m3", occurrence: 1, time: 2 }],
    markers: [{ at: { measure: "m3", beat: 2, occurrence: 1 }, text: "A" }],
    sections: [{ kind: "cut", from: { measure: "m3", beat: 0, occurrence: 1 }, to: { measure: "m3", beat: 3, occurrence: 1 } }],
    segue: false,
  };
}

function edit(changes: Partial<MeasureEdit>): MeasureEdit {
  return { ...createEmptyMeasureEdit(), ...changes };
}

describe("layer snapshots", () => {
  it("round-trip every layer", () => {
    const layers = makeLayers();

    expect(serializeLayers(deserializeLayers(serializeLayers(layers)))).toEqual(serializeLayers(layers));
  });

  it("name the fields whose stored form changed", () => {
    const layers = makeLayers();
    const relabeled = layers.measures.map(measure => measure.id === "m1" ? new Measure("m1", "1a", 4, LAYOUT) : measure);

    expect(getChangedFields(layers, { ...layers })).toEqual(new Set());
    expect(getChangedFields(layers, { ...layers, measures: relabeled, segue: true })).toEqual(new Set(["measures", "segue"]));
  });
});

describe("changesTiming", () => {
  it("changes only with the measure order, beats or recording", () => {
    const layers = makeLayers();
    const plan = (changes: Partial<MeasureEdit>): SongLayers => planMeasureEdit(layers, edit(changes)).layers;

    expect(changesTiming(layers, plan({ relabels: new Map([["m1", "2a"]]), layouts: new Map([["m2", LAYOUT]]) }))).toBe(false);
    expect(changesTiming(layers, { ...layers, markers: [], segue: true })).toBe(false);
    expect(changesTiming(layers, plan({ removals: ["m1"] }))).toBe(true);
    expect(changesTiming(layers, plan({ beats: new Map([["m1", 3]]) }))).toBe(true);
    expect(changesTiming(layers, plan({ additions: [{ label: "5", beats: 4, index: 4 }] }))).toBe(true);
    expect(changesTiming(layers, { ...layers, spans: [{ from: "m1", to: "m2" }] })).toBe(true);
  });
});

describe("planMeasureEdit", () => {
  it("removes neighbouring measures from the recording one after another", () => {
    const spans = [{ from: "m1", to: "m1" }, { from: "m2", to: "m4" }];
    const { layers } = planMeasureEdit({ ...makeLayers(), spans }, edit({ removals: ["m3", "m2"] }));

    expect(layers.measures.map(measure => measure.id)).toEqual(["m1", "m4"]);
    expect(layers.spans).toEqual([{ from: "m1", to: "m1" }, { from: "m4", to: "m4" }]);
  });

  it("drops references that no longer resolve only when the timeline changes", () => {
    const broken = { ...makeLayers(), markers: [{ at: { measure: "m1", beat: 9, occurrence: 1 }, text: "Old" }] };

    expect(planMeasureEdit(broken, edit({ relabels: new Map([["m1", "1a"]]) })).layers.markers).toHaveLength(1);
    expect(planMeasureEdit(broken, edit({ removals: ["m3"] })).layers).toMatchObject({ markers: [], warpMarkers: [], sections: [] });
  });

  it("leaves the given layers untouched", () => {
    const layers = makeLayers();
    const before = serializeLayers(layers);

    planMeasureEdit(layers, edit({ relabels: new Map([["m1", "1a"]]), removals: ["m2"], additions: [{ label: "5", beats: 4, index: 3 }] }));

    expect(serializeLayers(layers)).toEqual(before);
  });
});

describe("validateLayers", () => {
  it("checks only the changed fields while the timeline stays", () => {
    const layers = { ...makeLayers(), markers: [{ at: { measure: "m1", beat: 9, occurrence: 1 }, text: "Old" }] };

    expect(validateLayers(layers, new Set(["segue"]))).toBeUndefined();
    expect(validateLayers(layers, new Set(["markers"]))).toBe("Measure 1 has no beat 10.");
  });

  it("checks every reference once the timeline changes", () => {
    const layers = { ...makeLayers(), spans: [{ from: "m1", to: "m2" }] };

    expect(validateLayers(layers, new Set(["spans"]))).toBe("Measure 3 is not played 1 times.");
  });

  it("rejects broken measures, recordings and sync points", () => {
    const layers = makeLayers();
    const duplicate = [...layers.measures, new Measure("m5", "1", 4)];

    expect(validateLayers({ ...layers, measures: duplicate }, new Set(["measures"]))).toBe("Measure 1 exists twice.");
    expect(validateLayers({ ...layers, spans: [{ from: "m4", to: "m1" }] }, new Set(["spans"]))).toContain("score order");
    expect(validateLayers({ ...layers, warpMarkers: [...layers.warpMarkers, { measure: "m3", occurrence: 1, time: 3 }] }, new Set(["warpMarkers"])))
      .toBe("Measure 3 already has a sync point.");
  });
});

describe("sortReferences", () => {
  it("puts sync points, markers and sections in timeline order", () => {
    const layers = {
      ...makeLayers(),
      warpMarkers: [{ measure: "m3", occurrence: 1, time: 2 }, { measure: "m1", occurrence: 1, time: 0 }],
      markers: [{ at: { measure: "m4", beat: 0, occurrence: 1 }, text: "B" }, { at: { measure: "m2", beat: 0, occurrence: 1 }, text: "A" }],
    };

    const sorted = sortReferences(layers);

    expect(sorted.warpMarkers.map(marker => marker.measure)).toEqual(["m1", "m3"]);
    expect(sorted.markers.map(marker => marker.text)).toEqual(["A", "B"]);
  });
});
