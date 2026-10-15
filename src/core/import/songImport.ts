import { isBeatMapFile } from "../midi/beatMap";
import type { SongFiles } from "../models/song";
import { isNumbering } from "../utils/numbering";
import { inferTrackTitle } from "../utils/trackInference";

export type ImportFileKind = "score" | "midi" | "beatMap" | "recording";

export type ImportRow = {
  key: string;
  number: string;
  title: string;
  files: SongFiles;
};

export type SkippedFile = {
  file: File;
  reason: string;
};

export type ImportPlan = {
  rows: ImportRow[];
  skipped: SkippedFile[];
};

export type ExistingSong = {
  id: string;
  number: string;
  hasScore: boolean;
  playback: "midi" | "audio" | "none";
};

export type ResolvedImportRow = {
  action: "create" | "update";
  existingSongId?: string;
  files: SongFiles;
  notes: string[];
  warnings: string[];
};

const KIND_BY_EXTENSION: Record<string, ImportFileKind> = {
  pdf: "score",
  mid: "midi",
  midi: "midi",
  json: "beatMap",
  mp3: "recording",
};

const OTHER_AUDIO_EXTENSIONS = new Set(["wav", "flac", "ogg", "oga", "m4a", "aac", "aif", "aiff", "wma"]);

// "03 Title", "3a_Title", "No. 3 - Title", "#3 Title"
const NUMBERED_NAME = /^\s*(?:no\.?\s*|#)?0*(\d+[a-z]?)(?=$|[\s._)-])[\s._)-]*(.*)$/i;
const PART_SEPARATOR = /\s+[-–—]\s+/;

function splitExtension(filename: string): [string, string] {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? [filename, ""] : [filename.slice(0, dot), filename.slice(dot + 1).toLowerCase()];
}

function cleanTitle(value: string): string {
  return value.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}

type ParsedName = {
  number: string;
  title: string;
  part: string;
};

export function parseFilename(filename: string): ParsedName {
  const [stem] = splitExtension(filename);
  const match = stem.match(NUMBERED_NAME);
  const number = match ? match[1]!.toLowerCase() : "";
  const rest = cleanTitle(match ? match[2]! : stem);
  const separator = rest.search(PART_SEPARATOR);

  if (separator === -1) {
    return { number: isNumbering(number) ? number : "", title: rest, part: "" };
  }

  const [title, ...parts] = rest.split(PART_SEPARATOR);
  return { number: isNumbering(number) ? number : "", title: cleanTitle(title!), part: cleanTitle(parts.join(" - ")) };
}

const TITLE_PRIORITY: Record<ImportFileKind, number> = { score: 3, midi: 2, beatMap: 1, recording: 0 };

function classifyFile(file: File): { kind: ImportFileKind } | { reason: string } {
  const [, extension] = splitExtension(file.name);
  const kind = KIND_BY_EXTENSION[extension];

  if (kind) {
    return { kind };
  }

  if (OTHER_AUDIO_EXTENSIONS.has(extension)) {
    return { reason: "Recordings must be MP3 files." };
  }

  return { reason: "This file type is not supported." };
}

function groupKey(parsed: ParsedName): string {
  return parsed.number ? `#${parsed.number}` : `title:${parsed.title.toLowerCase()}`;
}

export function inferRecordingTitle(filename: string): string {
  const { part, title } = parseFilename(filename);
  return inferTrackTitle(part || title) || "Full Mix";
}

function addToRow(row: ImportRow, kind: ImportFileKind, file: File, parsed: ParsedName): string | undefined {
  if (kind === "recording") {
    row.files.recordings = [...row.files.recordings ?? [], { file, title: parsed.part ? inferTrackTitle(parsed.part) : "Full Mix" }];
    return undefined;
  }

  if (row.files[kind]) {
    return `Song ${row.number || row.title} already has a file of this kind.`;
  }

  row.files[kind] = file;
  return undefined;
}

/**
 * Groups files into songs by the number at the start of their names. Files that share a number
 * become one song, so "03 Prologue.pdf" and "03 Prologue - Alto.mp3" end up together.
 */
export async function planImport(files: File[]): Promise<ImportPlan> {
  const rowsByKey = new Map<string, ImportRow>();
  const titlePriorityByKey = new Map<string, number>();
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const classified = classifyFile(file);
    if ("reason" in classified) {
      skipped.push({ file, reason: classified.reason });
      continue;
    }

    const { kind } = classified;

    if (kind === "beatMap" && !(await isBeatMapFile(file))) {
      skipped.push({ file, reason: "This JSON file is not a beat map." });
      continue;
    }

    const parsed = parseFilename(file.name);
    const key = groupKey(parsed);
    const row = rowsByKey.get(key) ?? { key, number: parsed.number, title: "", files: {} };
    rowsByKey.set(key, row);

    // Score and MIDI names rarely carry a part suffix, so they are the best source for the title.
    if (parsed.title && TITLE_PRIORITY[kind] > (titlePriorityByKey.get(key) ?? -1)) {
      row.title = parsed.title;
      titlePriorityByKey.set(key, TITLE_PRIORITY[kind]);
    }

    const reason = addToRow(row, kind, file, parsed);
    if (reason) {
      skipped.push({ file, reason });
    }
  }

  return { rows: Array.from(rowsByKey.values()), skipped };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Decides what importing a row does to the show. A song plays either MIDI or recordings, never
 * both, and MIDI only plays together with its beat map. Files that would break that are dropped
 * with a warning instead of replacing what the song already uses.
 */
export function resolveImportRow(row: ImportRow, existing: ExistingSong | undefined): ResolvedImportRow {
  const files: SongFiles = { ...row.files, recordings: [...row.files.recordings ?? []] };
  const notes: string[] = [];
  const warnings: string[] = [];
  const existingPlayback = existing?.playback ?? "none";

  if (files.midi && files.recordings!.length > 0) {
    warnings.push("Has MIDI and recordings, only MIDI is imported.");
    files.recordings = [];
  }

  if (files.midi && !files.beatMap) {
    warnings.push("MIDI needs its beat map (.json) and is skipped.");
    delete files.midi;
  }

  if (files.beatMap && !files.midi) {
    warnings.push("Beat map without MIDI is skipped.");
    delete files.beatMap;
  }

  if (files.midi && existingPlayback === "audio") {
    warnings.push("Song plays recordings, MIDI is skipped.");
    delete files.midi;
    delete files.beatMap;
  }

  if (files.recordings!.length > 0 && existingPlayback === "midi") {
    warnings.push("Song plays MIDI, recordings are skipped.");
    files.recordings = [];
  }

  if (existing && files.score && existing.hasScore) {
    notes.push("Replaces score");
  }

  if (existing && files.midi && existingPlayback === "midi") {
    notes.push("Replaces MIDI");
  }

  if (files.recordings!.length > 0) {
    notes.push(`${existing ? "Adds" : "With"} ${plural(files.recordings!.length, "recording")}`);
  }

  if (!files.score && !files.midi && files.recordings!.length === 0) {
    warnings.push("Nothing left to import.");
  }

  return {
    action: existing ? "update" : "create",
    existingSongId: existing?.id,
    files,
    notes,
    warnings,
  };
}

export function hasImportableFiles(files: SongFiles): boolean {
  return !!files.score || !!files.midi || (files.recordings?.length ?? 0) > 0;
}
