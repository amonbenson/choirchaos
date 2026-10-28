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
      };
    })[];
  };
};
