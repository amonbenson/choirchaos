<script lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

onMounted(() => {
  // auto-select show
  // if (import.meta.env["VITE_PB_AUTOLOGIN_SHOW"]) {
  //   router.push(`/show/${import.meta.env["VITE_PB_AUTOLOGIN_SHOW"]}`);
  // }
});
</script>

<template>
  Home
</template>
