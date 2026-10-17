import { inferRecordingTitle } from "../import/songImport";
import { isBeatMap, tracksFromBeatMap } from "../midi/beatMap";
import { displayFilename, resolveFilename, type UrlOrFile } from "../utils/file";
import { isNumbering } from "../utils/numbering";
import { inferTrackClassification } from "../utils/trackInference";
import Song, { type SongFiles } from "./song";
import Track, { type TrackClassification } from "./track";

export type PlaybackMode = "none" | "midi" | "audio";

/**
 * A track as edited in the song dialog. A recording track either points to a stored file
 * (`audioFile`) or carries a new upload (`file`). MIDI tracks have neither.
 */
export type DraftTrack = {
  key: number;
  title: string;
  classification: TrackClassification;
  program: number;
  audioFile?: string;
  file?: File;
};

export type SongDraftErrors = Partial<Record<"number" | "title" | "playback" | "tracks", string>>;

let nextTrackKey = 0;

function draftTrack(fields: Omit<DraftTrack, "key">): DraftTrack {
  return { key: nextTrackKey++, ...fields };
}

function draftTrackFromTrack({ title, classification, program, audioFile }: Track): DraftTrack {
  return draftTrack({ title, classification, program, audioFile: audioFile || undefined });
}

function draftTrackFromRecording(file: File): DraftTrack {
  const title = inferRecordingTitle(file.name);
  return draftTrack({ title, classification: inferTrackClassification(title), program: 0, file });
}

// A stored recording without a track would otherwise count as removed and be deleted on save.
function draftRecordingTracks(song: Song): DraftTrack[] {
  const filenames = song.audioFiles.map(resolveFilename);
  const tracks = song.tracks.filter(track => filenames.includes(track.audioFile)).map(draftTrackFromTrack);
  const untracked = filenames
    .filter(filename => !song.tracks.some(track => track.audioFile === filename))
    .map((filename) => {
      const title = displayFilename(filename).replace(/\.[^.]+$/, "");
      return draftTrack({ title, classification: inferTrackClassification(title), program: 0, audioFile: filename });
    });

  return [...tracks, ...untracked];
}

function serializeTracks(tracks: readonly Track[]): string {
  return JSON.stringify(tracks.map(track => track.serialize()));
}

/**
 * Editable copy of a song's details, files and tracks. Nothing reaches the backend until save(),
 * which applies removals before uploads so the song never holds MIDI and recordings at the same time.
 */
export default class SongDraft {
  public number: string;
  public title: string;
  public score: UrlOrFile | undefined;
  public playback: PlaybackMode;
  public midi: UrlOrFile | undefined;
  public beatMap: UrlOrFile | undefined;
  public recordingTracks: DraftTrack[];
  public midiTracks: DraftTrack[];

  constructor(private readonly song?: Song, defaultNumber = "") {
    this.number = song?.number ?? defaultNumber;
    this.title = song?.title ?? "";
    this.score = song?.pdfFile;
    this.playback = song?.playerMode ?? "none";
    this.midi = song?.midiFile;
    this.beatMap = song?.jsonFile;

    this.recordingTracks = song && this.playback === "audio" ? draftRecordingTracks(song) : [];
    this.midiTracks = song && this.playback === "midi" ? song.tracks.map(draftTrackFromTrack) : [];
  }

  public getTracks(): DraftTrack[] {
    if (this.playback === "audio") {
      return this.recordingTracks;
    }

    if (this.playback === "midi") {
      return this.midiTracks;
    }

    return [];
  }

  public addRecordings(files: File[]): void {
    this.recordingTracks.push(...files.map(draftTrackFromRecording));
  }

  public removeTrack(track: DraftTrack): void {
    const tracks = this.getTracks();
    tracks.splice(tracks.indexOf(track), 1);
  }

  public moveTrack(from: number, to: number): void {
    const tracks = this.getTracks();
    if (to < 0 || to >= tracks.length) {
      return;
    }

    const [track] = tracks.splice(from, 1);
    tracks.splice(to, 0, track!);
  }

  /**
   * Takes the MIDI tracks from a new beat map. Tracks whose name stays keep their voice and
   * program, since only the name links a track to its MIDI data.
   */
  public async setBeatMap(file: File): Promise<boolean> {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return false;
    }

    if (!isBeatMap(json)) {
      return false;
    }

    this.beatMap = file;
    this.midiTracks = tracksFromBeatMap(json).map(track =>
      this.midiTracks.find(existing => existing.title === track.title) ?? draftTrackFromTrack(track),
    );
    return true;
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

    if (this.getTracks().some(track => !track.title.trim())) {
      errors.tracks = "Give every track a name.";
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

    return files;
  }

  private getNewRecordings(): File[] {
    return this.playback === "audio" ? this.recordingTracks.flatMap(track => track.file ? [track.file] : []) : [];
  }

  private getRemovedRecordings(song: Song): string[] {
    const kept = this.playback === "audio" ? new Set(this.recordingTracks.map(track => track.audioFile)) : new Set();
    return song.audioFiles.map(resolveFilename).filter(filename => !kept.has(filename));
  }

  /** Uploads new recordings and stores the track list in the edited order. Returns whether the tracks changed. */
  private async saveTracks(song: Song): Promise<boolean> {
    const newRecordings = this.getNewRecordings();
    const uploadedFilenames = await song.uploadAudioFiles(newRecordings);
    const filenameByFile = new Map(newRecordings.map((file, i) => [file, uploadedFilenames[i] ?? ""]));

    const tracks = this.getTracks().map(({ title, classification, program, audioFile, file }) =>
      new Track(title.trim(), classification, program, file ? filenameByFile.get(file) : audioFile),
    );

    if (serializeTracks(tracks) === serializeTracks(song.tracks)) {
      return false;
    }

    await song.setTracks(tracks);
    return true;
  }

  /** Returns the saved song and whether its playback changed, which requires a player reload. */
  public async save(showId: string, permissions?: Song["permissions"]): Promise<{ song: Song; playbackChanged: boolean }> {
    const details = { number: this.number.trim(), title: this.title.trim() };
    const files = this.getNewFiles();

    if (!this.song) {
      const song = await Song.create(showId, details, files, permissions);
      await this.saveTracks(song);
      return { song, playbackChanged: true };
    }

    const song = this.song;
    const removedRecordings = this.getRemovedRecordings(song);
    const removeScore = !!song.pdfFile && !this.score;
    const removeMidi = !!song.midiFile && this.playback !== "midi";
    const filesChanged = removeScore || removeMidi || removedRecordings.length > 0
      || !!files.score || !!files.midi || !!files.beatMap;

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
    const tracksChanged = await this.saveTracks(song);
    return { song, playbackChanged: filesChanged || tracksChanged };
  }
}
