<script setup lang="ts">
import { parseData } from "@/core/scripts/bundlemti";
import axios from "axios";
import Button from "primevue/button";
import PocketBase from "pocketbase";


async function provision() {
  // generate data
  const cloudfrontUrl = "/test/mti/cloudfront";
  const license_check = (await axios.get("/test/mti/license_check.json")).data;
  const show_changes = (await axios.get("/test/mti/show_changes.json")).data;

  const show = await parseData(license_check, show_changes, cloudfrontUrl);

  // login to pocketbase
  console.log("Logging in to firebase...");
  const pb = new PocketBase("https://choirchaos-pb.goatlessband.com/");
  pb.autoCancellation(false);
  await pb.collection("_superusers").authWithPassword(import.meta.env["VITE_PB_SUPERUSER_EMAIL"], import.meta.env["VITE_PB_SUPERUSER_PASS"], {
    autoRefreshThreshold: 30 * 60,
  });

  try {
    // create show
    console.log(`Creating show '${show.title}'`);
    const { id: _, songs: __, thumbnail: ___, ...showData } = show.json();
    const showRecord = await pb.collection("shows").create(showData);

    // create songs
    for (const song of show.songs) {
      console.log(`Creating song '#${song.number} ${song.title}'`);
      const { id: _,  ...songData } = song.json();
      await pb.collection("songs").create({
        show: showRecord.id,
        ...songData,
      });
    }

    console.log("Finished!");
  } catch (err) {
    console.error("Provision failed!");
    console.log(err);
    console.log(err.response);
  }
}
</script>

<template>
  <Button
    label="Provision"
    @click="provision()"
  />
</template>
