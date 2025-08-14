export type MTISong = {
  songId: string;
  number: number;
  title: string;
  midiFileUrl?: string;
  jsonFileUrl?: string;
  measures: {
    name: string;
    beats: number;
  }[];
  tracks: {
    trackIndex: number;
    channelIndex: number;
    title: string;
    classification: string;
  }[];
  changes: {
    tempo: {
      factor: number;
    };
    transpose: {
      numHalfSteps: number;
    };
    cuts: [unknown];
    repeats: {
      iterations: number;
      startLocation: {
        measure: number;
        beat: number;
        tick: number;
      };
      endLocation: {
        measure: number;
        beat: number;
        tick: number;
      };
    }[];
    markers: {
      text: string;
      location: {
        measure: number;
        beat: number;
        tick: number;
      };
    }[];
    attacca: null | {
      location: {
        measure: number;
        beat: number;
        tick: number;
      };
    };
    tempoNoteChanges: {
      tempo: unknown;
      note: string;
      location: {
        measure: number;
        beat: number;
        tick: number;
      };
    }[];
  };
  updateInVersion?: false;
  updateCategory?: null;
  updateChangeTypes?: [unknown];
  updateNotes?: null;
  releaseNotes?: null;
  publishedById?: null;
  publishDate?: string;
  createdDate?: string;
  lastUpdate?: string;
  isDeleted?: boolean;
  deleteReason?: string;
};

export type MTIShow = {
  _id: string;
  showId: string;
  versionNumber: number;
  title: string;
  thumbnailUrl: string;
  songs: MTISong[];
  publishDate: string;
  releaseNotes: string;
  isLive: boolean;
  liveReleaseNotes: string;
  liveDate: string;
  createdDate: string;
  lastUpdated: string;
  isDeleted: boolean;
  deleteReason: string;
}

export type MTILicenseCheck = {
  show: MTIShow;
  license: unknown;
  licenseUser: unknown;
  token: string;
};

export type MTILicenseActivation = MTILicenseCheck;

export type MTIShowChanges = {
  songs: MTISong[];
}
