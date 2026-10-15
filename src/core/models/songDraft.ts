import { inferRecordingTitle } from "../import/songImport";
import { resolveFilename, type UrlOrFile } from "../utils/file";
import { isNumbering } from "../utils/numbering";
import Song, { type SongFiles, type SongRecording } from "./song";

export type PlaybackMode = "none" | "midi" | "audio";

export type StoredRecording = {
  filename: string;
  title: string;
};

export type SongDraftErrors = Partial<Record<"number" | "title" | "playback", string>>;

/**
 * Editable copy of a song's details and files. Nothing reaches the backend until save(), which
 * applies removals before uploads so the song never holds MIDI and recordings at the same time.
 */
export default class SongDraft {
  public number: string;
  public title: string;
  public score: UrlOrFile | undefined;
  public playback: PlaybackMode;
  public midi: UrlOrFile | undefined;
  public beatMap: UrlOrFile | undefined;
  public storedRecordings: StoredRecording[];
  public newRecordings: SongRecording[] = [];

  constructor(private readonly song?: Song, defaultNumber = "") {
    this.number = song?.number ?? defaultNumber;
    this.title = song?.title ?? "";
    this.score = song?.pdfFile;
    this.playback = song?.playerMode ?? "none";
    this.midi = song?.midiFile;
    this.beatMap = song?.jsonFile;
    this.storedRecordings = (song?.audioFiles ?? []).map((file) => {
      const filename = resolveFilename(file);
      return { filename, title: song?.tracks.find(t => t.audioFile === filename)?.title ?? filename };
    });
  }

  public addRecordings(files: File[]): void {
    this.newRecordings.push(...files.map(file => ({ file, title: inferRecordingTitle(file.name) })));
  }

  public validate(takenNumbers: string[]): SongDraftErrors {
    const errors: SongDraftErrors = {};
    const number = this.number.trim();

    if (!isNumbering(number)) {
      errors.number = "Use a number like 3 or 3a.";
    } else if (number !== this.song?.number && takenNumbers.includes(number)) {
      errors.number = `Song ${number} already exists.`;
    }

    if (!this.title.trim()) {
      errors.title = "Enter a title.";
    }

    if (this.playback === "midi" && (!this.midi || !this.beatMap)) {
      errors.playback = "MIDI playback needs a MIDI file and its beat map.";
    }

    return errors;
  }

  public getRemovedPlaybackKind(): "MIDI" | "recordings" | undefined {
    if (this.song?.midiFile && this.playback !== "midi") {
      return "MIDI";
    }

    if (this.song?.audioFiles.length && this.playback !== "audio") {
      return "recordings";
    }

    return undefined;
  }

  private getNewFiles(): SongFiles {
    const files: SongFiles = {};

    if (this.score instanceof File) {
      files.score = this.score;
    }

    if (this.playback === "midi") {
      files.midi = this.midi instanceof File ? this.midi : undefined;
      files.beatMap = this.beatMap instanceof File ? this.beatMap : undefined;
    }

    if (this.playback === "audio") {
      files.recordings = this.newRecordings;
    }

    return files;
  }

  private getRemovedRecordings(song: Song): string[] {
    const kept = this.playback === "audio" ? new Set(this.storedRecordings.map(r => r.filename)) : new Set();
    return song.audioFiles.map(resolveFilename).filter(filename => !kept.has(filename));
  }

  /** Returns the saved song and whether its playback files changed, which requires a player reload. */
  public async save(showId: string, permissions?: Song["permissions"]): Promise<{ song: Song; filesChanged: boolean }> {
    const details = { number: this.number.trim(), title: this.title.trim() };
    const files = this.getNewFiles();

    if (!this.song) {
      return { song: await Song.create(showId, details, files, permissions), filesChanged: true };
    }

    const song = this.song;
    const removedRecordings = this.getRemovedRecordings(song);
    const removeScore = !!song.pdfFile && !this.score;
    const removeMidi = !!song.midiFile && this.playback !== "midi";
    const filesChanged = removeScore || removeMidi || removedRecordings.length > 0
      || !!files.score || !!files.midi || !!files.beatMap || (files.recordings?.length ?? 0) > 0;

    if (details.number !== song.number || details.title !== song.title) {
      await song.updateDetails(details);
    }

    if (removeScore) {
      await song.removeScore();
    }

    if (removeMidi) {
      await song.removeMidiFile();
    }

    for (const filename of removedRecordings) {
      await song.removeAudioFile(filename);
    }

    await song.addFiles(files);
    return { song, filesChanged };
  }
}
