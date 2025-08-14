# Choir Chaos

## Show Data Structure
```
export default {
  show: {
    id: "1234",
    title: "Come From Away",
    thumbnailUrl: "https://...",
    songs: [
      {
        id: "1234",
        number: "1A",
        title: "Welcome to the Rock",
        midiFileUrl: "",
        tracks: [
          {
            index: 0,
            title: "Piano",
            classification: "Accompaniment" | "Percussion" | "Vocal",
            program: 0 | 9,
            $midi: { // populated from MIDI file
              note: [
                {
                  tick: 0,
                  duration: 100,
                  pitch: 60,
                  velocity: 100,
                },
              ],
              tempo: [
                {
                  tick: 0,
                  bpm: 120,
                },
              ],
              timeSignature: [
                {
                  tick: 0,
                  value: [4, 4],
                },
              ],
            },
          },
        ],
        measures: [
          {
            value: "1A",
            beatTicks: [
              0,
              200,
              300,
              400,
            ],
            layout: null | {
              page: 0,
              x: 0.1,
              y: 0.1,
              width: 0.1,
              height: 0.1,
            },
          },
        ],
        events: {
          sections: [
            {
              measure: ["1A", 0],
              value: "Intro",
              $tick: 0,
            },
          ],
          markers: [
            {
              measure: ["1A", 0],
              value: "Start",
              $tick: 0,
            },
          ],
          vamps: [
            {
              measure: ["1A", 0],
              end: ["1A", 2],
            },
          ],
          segue: false,
        },
      },
    ],
  },
};
```
