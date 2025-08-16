export type MTISong = {
  songId: string;
  number: string;
  title: string;
  midiFileUrl: string;
  jsonFileUrl: string;
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
        measure: string;
        beat: number;
        tick: number;
      };
      endLocation: {
        measure: string;
        beat: number;
        tick: number;
      };
    }[];
    markers: {
      text: string;
      location: {
        measure: string;
        beat: number;
        tick: number;
      };
    }[];
    attacca: null | {
      location: {
        measure: string;
        beat: number;
        tick: number;
      };
    };
    tempoNoteChanges: {
      tempo: unknown;
      note: string;
      location: {
        measure: string;
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
  thumbnailImageUrl: string;
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
};

export type MTILicenseCheck = {
  show: MTIShow;
  license: unknown;
  licenseUser: unknown;
  token: string;
};

export type MTILicenseActivation = MTILicenseCheck;

export type MTIShowChanges = {
  songs: MTISong[];
};

export type MTIMidiJson = {
  score: {
    title: string;
    ppqn: number;
    trackNames: {
      cnt: number;
      track: {
        name: string;
        channel: number;
      }[];
    };
    jumpTable: {
      cnt: number;
      entries: {
        tickcount: number;
        name: string;
        meas: string;
        beat: number;
        tick: number;
      }[];
    };
    events: ({
      tickcount: number;
      type: "TEMPO";
      value: {
        bpm: number;
        ticksPerQuarter: number;
      };
    } | {
      tickcount: number;
      type: "TIMESIG";
      value: {
        numerator: number;
        denominator: number;
        metroCount: number;
        _32nds: number;
      };
    } | {
      tickcount: number;
      type: "BEAT";
      value: {
        meas: string;
        beat: number;
        tick: number;
      }
    })[];
  };
};
