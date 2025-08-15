// import fs from "fs/promises";
// import path from "path";
import axios from "axios";
import type { MTILicenseCheck, MTIShowChanges } from "./jsonTypes/mti";
import Show from "@/core/player/show";
import Song from "@/core/player/song";
import Track from "@/core/player/track";
import Measure from "@/core/player/measure";
import { MarkerEvent, VampEvent } from "@/core/player/measureEvent";

// const BASE_DIR = "./public/test/mti";
// const CLOUDFRONT_DIR = path.join(BASE_DIR, "cloudfront");
// const LICENSE_CHECK_FILENAME = path.join(BASE_DIR, "license_check.json");
// const SHOW_CHANGES_FILENAME = path.join(BASE_DIR, "show_changes.json");
// const BUNDLE_FILENAME = path.join(BASE_DIR, "bundle.json");

// // load files
// async function loadJson<T>(filename: string) {
//   const buffer = await fs.readFile(filename, "utf-8");
//   return JSON.parse(buffer) as T;
// }

// async function loadBlob(filename: string) {
//   const buffer = await fs.readFile(filename, "utf-8");
//   return new File([buffer], path.basename(filename));
// }

// async function storeJson(filename: string, data: any) {
//   const buffer = JSON.stringify(data);
//   await fs.writeFile(filename, buffer, "utf-8");
// }

async function loadBlob(filename: string, cloudfrontUrl: string) {
  const sanitizedFilename = filename.replace(/[\/]/g, "_");
  const result = await axios.get(`${cloudfrontUrl}/${sanitizedFilename}`, { transformResponse: r => r });
  return new File([result.data], sanitizedFilename);
}

export async function parseData(mtiShow: MTILicenseCheck, mtiChanges: MTIShowChanges, cloudfrontUrl: string) {
  // console.log("Loading MTI data...");
  // const mtiShow = await loadJson<MTILicenseCheck>(LICENSE_CHECK_FILENAME);
  // const mtiChanges = await loadJson<MTIShowChanges>(SHOW_CHANGES_FILENAME);

  console.log("Combining MTI data...");

  // generate show
  const show = new Show(mtiShow.show.showId);
  show.title = mtiShow.show.title;
  show.thumbnail = await loadBlob(mtiShow.show.thumbnailImageUrl, cloudfrontUrl);

  // generate songs
  for (const mtiSong of mtiShow.show.songs) {
    // apply changes
    const songChanges = mtiChanges.songs.find(s => s.songId === mtiSong.songId);
    if (songChanges) {
      Object.assign(mtiSong, songChanges);
    } else {
      console.warn(`No changes found for song '${mtiSong.title}'`);
    }

    // create a new song
    const song = new Song(mtiSong.songId, mtiSong.number);
    song.title = mtiSong.title;
    song.midiFile = await loadBlob(mtiSong.midiFileUrl, cloudfrontUrl);
    song.jsonFile = await loadBlob(mtiSong.jsonFileUrl, cloudfrontUrl);

    // generate tracks
    for (const [i, mtiTrack] of mtiSong.tracks.entries()) {
      if (i !== mtiTrack.trackIndex) {
        console.warn(`trackIndex (${mtiTrack.trackIndex}) does not match actual index (${i}) for song '${mtiSong.title}', track '${mtiTrack.title}'`);
      }

      const track = new Track();
      track.title = mtiTrack.title;
      track.classification = mtiTrack.classification;
      track.program = mtiTrack.channelIndex;
      song.tracks.push(track);
    }

    // generate measures (without tick data)
    for (const mtiMeasure of mtiSong.measures) {
      const measure = new Measure(mtiMeasure.name, mtiMeasure.beats);
      song.measures.push(measure);
    }

    // generate change events
    const mref = (location: { measure: string, beat: number }): [string, number] => [location.measure, location.beat - 1];

    for (const mtiMarker of mtiSong.changes.markers) {
      const marker = new MarkerEvent(mref(mtiMarker.location), mtiMarker.text);
      song.events.markers.push(marker);
    }

    for (const mtiRepeat of mtiSong.changes.repeats) {
      const vamp = new VampEvent(mref(mtiRepeat.startLocation), mref(mtiRepeat.endLocation), mtiRepeat.iterations);
      song.events.vamps.push(vamp);
    }

    song.events.segue = !!mtiSong.changes.attacca;

    show.songs.push(song);
  }

  // store show data
  // console.log("Storing bundle...");
  // storeJson(BUNDLE_FILENAME, show.json());

  return show;
}
