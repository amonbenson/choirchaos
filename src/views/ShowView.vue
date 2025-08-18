<script setup lang="ts">
import Show from "@/core/show/show";
import { usePlayerStore } from "@/stores/player";
import { computed, watch, ref, markRaw, type Ref, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import TransportBar from "@/components/TransportBar.vue";
import type Song from "@/core/show/song";
import PdfViewer from "@/components/PdfViewer.vue";

const player = usePlayerStore();
const route = useRoute();
const router = useRouter();

const props = defineProps<{
  showId: string,
  songId?: string,
}>();

// store show and current song data from pocketbase
const show: Ref<Show | undefined> = ref();
const showLoading = ref(true);

const song: ComputedRef<Song | undefined> = computed(() => show.value?.songs.find(s => s.id === props.songId));
const songLoading = ref(true);

function selectSong(songId?: string) {
  // route to the correct song first
  if (songId && songId !== props.songId) {
    router.replace({
      name: "song",
      params: {
        showId: props.showId,
        songId,
      },
    });
  }
}

// reload when the show id changes
watch([show, song], async () => {
  if (show.value && song.value) {
    try {
      songLoading.value = true;
      await player.load(song.value!);
    } catch (err) {
      console.error(err);
    } finally {
      songLoading.value = false;
    }
  }
});

// fetch the show data from pocketbase on setup
async function fetchShow() {
  try {
    showLoading.value = true;
    const showObj = await Show.get(route.params.showId as string);

    // mark expensive/large reference properties as raw so vue doesn't try to make them reactive.
    // They cannot be changed anyway unless the whole show object is replaced
    for (const song of showObj.songs) {
      song.$midiSystemEvents = markRaw(song.$midiSystemEvents);

      for (const track of song.tracks) {
        track.$midiTrackEvents = markRaw(track.$midiTrackEvents);
      }

      for (const measure of song.measures.items()) {
        measure.$beatTicks = markRaw(measure.$beatTicks);
      }
    }

    // TEMP: inject layout for the first song
    const staffData = [[{"layout":{"x":0.15634517766497463,"y":0.3152466367713005,"height":0.2269058295964124},"measures":[{"layout":{"width":0.1170050761421319},"measure":"1"},{"measure":"2","layout":{"width":0.17664974619289348}},{"measure":"3","layout":{"width":0.15}},{"measure":"4","layout":{"width":0.15}},{"measure":"5","layout":{"width":0.15761421319796956}}]},{"layout":{"x":0.09035532994923853,"y":0.611659192825112,"height":0.22600896860986558},"measures":[{"layout":{"width":0.23375634517766508,"x":null},"measure":"6"},{"measure":"7","layout":{"width":0.1893401015228427}},{"measure":"8","layout":{"width":0.20583756345177656}},{"measure":"9","layout":{"width":0.18680203045685267}}]}],[{"layout":{"x":0.08908629441624365,"y":0.1448430493273542,"height":0.19641255605381164},"measures":[{"layout":{"width":0.236294416243655,"x":null},"measure":"10"},{"measure":"11","layout":{"width":0.1868020304568527}},{"measure":"12","layout":{"width":0.18426395939086287}},{"measure":"13","layout":{"width":0.20710659898477146}}]},{"layout":{"x":0.08654822335025376,"y":0.39910313901345296,"height":0.21165919282511209},"measures":[{"layout":{"width":0.3098984771573606,"x":null},"measure":"14"},{"measure":"15","layout":{"width":0.25279187817258875}},{"measure":"16","layout":{"width":0.2540609137055838}}]},{"layout":{"x":0.0890862944162436,"y":0.6677130044843055,"height":0.1838565022421525},"measures":[{"layout":{"width":0.28959390862944173,"x":null},"measure":"17"},{"measure":"18","layout":{"width":0.269289340101523}},{"measure":"19","layout":{"width":0.25532994923857855}}]}],[{"layout":{"x":0.09289340101522835,"y":0.1520179372197309,"height":0.3282511210762331},"measures":[{"layout":{"width":0.3098984771573606,"x":null},"measure":"20"},{"measure":"21","layout":{"width":0.2565989847715736}},{"measure":"21A","layout":{"width":0.2451776649746195}}]},{"layout":{"x":0.08908629441624358,"y":0.5273542600896861,"height":0.33452914798206257},"measures":[{"layout":{"width":0.23248730964467026,"x":null},"measure":"22"},{"measure":"23","layout":{"width":0.20456852791878188}},{"measure":"24","layout":{"width":0.18553299492385764}},{"measure":"25","layout":{"width":0.1931472081218272}}]}],[{"layout":{"x":0.09035532994923852,"y":0.14484304932735426,"height":0.17578475336322874},"measures":[{"layout":{"width":0.1703045685279188,"x":null},"measure":"26"},{"measure":"27","layout":{"width":0.13477157360406095}},{"measure":"28","layout":{"width":0.12588832487309634}},{"measure":"29","layout":{"width":0.12715736040609135}},{"measure":"30","layout":{"width":0.12461928934010154}},{"measure":"31","layout":{"width":0.13096446700507608}}]},{"layout":{"x":0.08908629441624356,"y":0.3748878923766818,"height":0.20089686098654713},"measures":[{"layout":{"width":0.2883248730964468,"x":null},"measure":"32"},{"measure":"33","layout":{"width":0.2553299492385788}},{"measure":"34","layout":{"width":0.27182741116751225}}]},{"layout":{"x":0.08781725888324868,"y":0.6309417040358747,"height":0.2044843049327353},"measures":[{"layout":{"width":0.31116751269035536,"x":null},"measure":"35"},{"measure":"36","layout":{"width":0.2654822335025384}},{"measure":"37","layout":{"width":0.23883248730964457}}]}],[{"layout":{"x":0.09289340101522839,"y":0.14573991031390132,"height":0.22869955156950666},"measures":[{"layout":{"width":0.28451776649746185,"x":null},"measure":"38"},{"measure":"39","layout":{"width":0.2807106598984771}},{"measure":"40","layout":{"width":0.25152284263959385}}]}],[{"layout":{"x":0.08781725888324869,"y":0.14484304932735426,"height":0.33183856502242154},"measures":[{"layout":{"width":0.323857868020305,"x":null},"measure":"41"},{"measure":"42","layout":{"width":0.24390862944162442}},{"measure":"42A","layout":{"width":0.24898477157360427}}]},{"layout":{"x":0.09035532994923856,"y":0.5282511210762331,"height":0.3282511210762333},"measures":[{"layout":{"width":0.24263959390862963,"x":null},"measure":"43"},{"measure":"44","layout":{"width":0.19314720812182756}},{"measure":"45","layout":{"width":0.18807106598984774}},{"measure":"46","layout":{"width":0.18934010152284236}}]}],[{"layout":{"x":0.09162436548223346,"y":0.1502242152466368,"height":0.2950672645739909},"measures":[{"layout":{"width":0.2324873096446702,"x":null},"measure":"47"},{"measure":"48","layout":{"width":0.1969543147208122}},{"measure":"49","layout":{"width":0.1931472081218274}},{"measure":"50","layout":{"width":0.19314720812182737}}]},{"layout":{"x":0.08781725888324869,"y":0.49686098654708516,"height":0.15784753363228696},"measures":[{"layout":{"width":0.2413705583756346,"x":null},"measure":"51"},{"measure":"52","layout":{"width":0.21472081218274122}},{"measure":"53","layout":{"width":0.20583756345177676}},{"measure":"54","layout":{"width":0.1588832487309643}}]},{"layout":{"x":0.09035532994923855,"y":0.7089686098654708,"height":0.14529147982062784},"measures":[{"layout":{"width":0.23629441624365496,"x":null},"measure":"55"},{"measure":"56","layout":{"width":0.2096446700507615}},{"measure":"57","layout":{"width":0.20329949238578676}},{"measure":"58","layout":{"width":0.16903553299492355}}]}],[{"layout":{"x":0.09416243654822329,"y":0.1699551569506726,"height":0.13004484304932742},"measures":[{"layout":{"width":0.22233502538071087,"x":null},"measure":"59"},{"measure":"60","layout":{"width":0.20076142131979707}},{"measure":"61","layout":{"width":0.19314720812182745}},{"measure":"62","layout":{"width":0.19187817258883225}}]},{"layout":{"x":0.09162436548223342,"y":0.35246636771300466,"height":0.14977578475336326},"measures":[{"layout":{"width":0.4012690355329953,"x":null},"measure":"63"},{"measure":"64","layout":{"width":0.4088832487309644}}]},{"layout":{"x":0.09162436548223343,"y":0.5600896860986546,"height":0.29237668161434965},"measures":[{"layout":{"width":0.254060913705584,"x":null},"measure":"65"},{"measure":"66","layout":{"width":0.2032994923857867}},{"measure":"67","layout":{"width":0.17157360406091365}},{"measure":"68","layout":{"width":0.18680203045685292}}]}],[{"layout":{"x":0.09162436548223346,"y":0.1654708520179372,"height":0.29865470852017945},"measures":[{"layout":{"width":0.2565989847715737,"x":null},"measure":"69"},{"measure":"70","layout":{"width":0.21345177664974613}},{"measure":"71","layout":{"width":0.15253807106598968}},{"measure":"72","layout":{"width":0.1931472081218271}}]},{"layout":{"x":0.08908629441624363,"y":0.5336322869955158,"height":0.295067264573991},"measures":[{"layout":{"width":0.2591370558375636,"x":null},"measure":"73"},{"measure":"74","layout":{"width":0.20456852791878163}},{"measure":"75","layout":{"width":0.1766497461928934}},{"measure":"76","layout":{"width":0.17791878172588813}}]}],[{"layout":{"x":0.08908629441624366,"y":0.17264573991031384,"height":0.29417040358744395},"measures":[{"layout":{"width":0.3149746192893401,"x":null},"measure":"77"},{"measure":"78","layout":{"width":0.25025380710659934}},{"measure":"79","layout":{"width":0.21218274111675114}}]},{"layout":{"x":0.08908629441624362,"y":0.5506726457399104,"height":0.22780269058295965},"measures":[{"layout":{"width":0.24517766497461949,"x":null},"measure":"80"},{"measure":"81","layout":{"width":0.20710659898477157}},{"measure":"82","layout":{"width":0.18553299492385797}},{"measure":"83","layout":{"width":0.18045685279187795}}]}],[{"layout":{"x":0.09670050761421321,"y":0.14753363228699548,"height":0.20269058295964146},"measures":[{"layout":{"width":0.23375634517766508,"x":null},"measure":"84"},{"measure":"85","layout":{"width":0.2032994923857868}},{"measure":"86","layout":{"width":0.19060913705583754}},{"measure":"87","layout":{"width":0.16776649746192893}}]},{"layout":{"x":0.09289340101522844,"y":0.4,"height":0.2035874439461883},"measures":[{"layout":{"width":0.24137055837563465,"x":null},"measure":"88"},{"measure":"89","layout":{"width":0.21218274111675128}},{"measure":"90","layout":{"width":0.19060913705583765}},{"measure":"91","layout":{"width":0.1703045685279189}}]},{"layout":{"x":0.09162436548223347,"y":0.6614349775784757,"height":0.20358744394618838},"measures":[{"layout":{"width":0.44060913705583765,"x":null},"measure":"92"},{"measure":"93","layout":{"width":0.3695431472081217}}]}],[{"layout":{"x":0.08908629441624366,"y":0.16547085201793715,"height":0.29417040358744384},"measures":[{"layout":{"width":0.43553299492385816,"x":null},"measure":"94"},{"measure":"95","layout":{"width":0.37842639593908606}}]},{"layout":{"x":0.0916243654822335,"y":0.5327354260089685,"height":0.30403587443946206},"measures":[{"layout":{"width":0.23883248730964485,"x":null},"measure":"96"},{"measure":"97","layout":{"width":0.18553299492385783}},{"measure":"98","layout":{"width":0.1944162436548223}},{"measure":"99","layout":{"width":0.19314720812182729}}]}],[{"layout":{"x":0.09289340101522837,"y":0.16278026905829604,"height":0.293273542600897},"measures":[{"layout":{"width":0.23629441624365505,"x":null},"measure":"100"},{"measure":"101","layout":{"width":0.19568527918781736}},{"measure":"102","layout":{"width":0.19314720812182734}},{"measure":"103","layout":{"width":0.18934010152284253}}]},{"layout":{"x":0.09035532994923852,"y":0.5246636771300448,"height":0.31300448430493266},"measures":[{"layout":{"width":0.24010152284263983,"x":null},"measure":"104"},{"measure":"105","layout":{"width":0.1906091370558376}},{"measure":"106","layout":{"width":0.19187817258883247}},{"measure":"107","layout":{"width":0.19568527918781695}}]}],[{"layout":{"x":0.08908629441624365,"y":0.24977578475336326,"height":0.4475336322869957},"measures":[{"layout":{"width":0.17030456852791873,"x":null},"measure":"108"},{"measure":"109","layout":{"width":0.1284263959390863}},{"measure":"110","layout":{"width":0.12335025380710654}},{"measure":"111","layout":{"width":0.133502538071066}},{"measure":"112","layout":{"width":0.12461928934010164}},{"measure":"113","layout":{"width":0.13477157360406086}}]}],[{"layout":{"x":0.09162436548223343,"y":0.14753363228699554,"height":0.3004484304932734},"measures":[{"layout":{"width":0.23883248730964493,"x":null},"measure":"114"},{"measure":"115","layout":{"width":0.19441624365482243}},{"measure":"116","layout":{"width":0.19060913705583749}},{"measure":"117","layout":{"width":0.19441624365482202}}]},{"layout":{"x":0.09162436548223346,"y":0.5192825112107626,"height":0.3327354260089686},"measures":[{"layout":{"width":0.22106598984771592,"x":null},"measure":"118"},{"measure":"119","layout":{"width":0.18553299492385794}},{"measure":"120","layout":{"width":0.18426395939086287}},{"measure":"121","layout":{"width":0.19060913705583735}}]}],[{"layout":{"x":0.09035532994923852,"y":0.15874439461883422,"height":0.30313901345291505},"measures":[{"layout":{"width":0.2515228426395941,"x":null},"measure":"121A"},{"measure":"121B","layout":{"width":0.1817258883248731}},{"measure":"121C","layout":{"width":0.19822335025380727}},{"measure":"121D","layout":{"width":0.18426395939086315}}]},{"layout":{"x":0.09035532994923852,"y":0.5394618834080723,"height":0.2941704035874438},"measures":[{"layout":{"width":0.2616751269035535,"x":null},"measure":"121E"},{"measure":"121F","layout":{"width":0.1918781725888325}},{"measure":"121G","layout":{"width":0.1855329949238576}},{"measure":"121H","layout":{"width":0.1728426395939084}}]}],[{"layout":{"x":0.09289340101522842,"y":0.1457399103139013,"height":0.23677130044843042},"measures":[{"layout":{"width":0.254060913705584,"x":null},"measure":"122"},{"measure":"123","layout":{"width":0.18553299492385794}},{"measure":"124","layout":{"width":0.1956852791878171}},{"measure":"125","layout":{"width":0.18045685279187804}}]}],[{"layout":{"x":0.08908629441624362,"y":0.1636771300448431,"height":0.2941704035874444},"measures":[{"layout":{"width":0.2591370558375636,"x":null},"measure":"126"},{"measure":"127","layout":{"width":0.18172588832487316}},{"measure":"128","layout":{"width":0.184263959390863}},{"measure":"129","layout":{"width":0.18807106598984755}}]},{"layout":{"x":0.08908629441624362,"y":0.5381165919282509,"height":0.2923766816143496},"measures":[{"layout":{"width":0.23883248730964485,"x":null},"measure":"130"},{"measure":"131","layout":{"width":0.19568527918781733}},{"measure":"132","layout":{"width":0.19822335025380686}},{"measure":"133","layout":{"width":0.18172588832487283}}]}],[{"layout":{"x":0.09670050761421313,"y":0.16636771300448436,"height":0.295067264573991},"measures":[{"layout":{"width":0.4659898477157361,"x":null},"measure":"134"},{"measure":"135","layout":{"width":0.34670050761421284}}]},{"layout":{"x":0.08908629441624358,"y":0.5345291479820626,"height":0.29417040358744423},"measures":[{"layout":{"width":0.31497461928933984,"x":null},"measure":"136"},{"measure":"137","layout":{"width":0.25786802030456846}},{"measure":"138","layout":{"width":0.24010152284263966}}]}]];
    for (const [page, pageStaffs] of staffData.entries()) {
      for (const staff of pageStaffs) {
        let x = staff.layout.x;
        for (const measure of staff.measures) {
          // lookup measure in song
          const songMeasure = showObj.songs[0].findMeasure(measure.measure)!;
          songMeasure.layout = {
            page,
            x,
            y: staff.layout.y,
            width: measure.layout.width,
            height: staff.layout.height,
          };
          x += measure.layout.width;
        }
      }
    }

    // set the show
    show.value = showObj;

    const songObj = showObj.songs.find(s => s.id === props.songId) ?? null;
    if (!songObj) {
      // if no valid song is selected, route to the first song
      selectSong(showObj.songs[0].id);
    }
  } catch (err) {
    console.error(err);
  } finally {
    showLoading.value = false;
  }
}

fetchShow();
</script>

<template>
  <div class="fixed left-0 top-0 w-screen h-screen flex flex-col justify-stretch items-stretch gap-2 p-2">
    <TransportBar
      class="flex-none"
      :model-value="songId"
      :songs="show?.songs"
      :loading="showLoading || songLoading"
      @update:model-value="selectSong($event)"
    />
    <PdfViewer
      class="flex-1 size-full"
      :song="song"
    />
  </div>
</template>
