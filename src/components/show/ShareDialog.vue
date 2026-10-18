<script setup lang="ts">
import { useClipboard } from "@vueuse/core";
import Avatar from "primevue/avatar";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { useNotify } from "@/composables/useNotify";
import type Show from "@/core/models/show";
import type { ShowMember } from "@/core/models/show";
import { pb } from "@/pocketbase";
import type { Visibility } from "@/pocketbase/auth";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{
  show: Show;
}>();

const visible = defineModel<boolean>({ required: true });

const auth = useAuthStore();
const router = useRouter();
const { notifyError, notifySuccess } = useNotify();
const { copy } = useClipboard({ legacy: true });

type InviteRole = "editor" | "viewer";

const ROLE_OPTIONS: { label: string; value: InviteRole }[] = [
  { label: "Can view", value: "viewer" },
  { label: "Can edit", value: "editor" },
];

const VISIBILITY_OPTIONS: { label: string; value: Visibility; icon: string; description: string }[] = [
  { label: "Only people added", value: "private", icon: "pi-lock", description: "Only the people listed above can open this show." },
  { label: "Anyone with the link", value: "unlisted", icon: "pi-link", description: "Anyone with the link can listen, no account needed. It is not listed on the home page." },
  { label: "Public", value: "public", icon: "pi-globe", description: "Listed on the home page for everyone, no account needed." },
];

const members = ref<ShowMember[]>([]);
const membersError = ref(false);
const loadingMembers = ref(false);
const inviteEmail = ref("");
const inviteRole = ref<InviteRole>("viewer");
const inviting = ref(false);

const isOwner = computed(() => props.show.getRole(auth.user?.id) === "owner");
const visibility = computed(() => VISIBILITY_OPTIONS.find(o => o.value === props.show.permissions.visibility)!);
const showUrl = computed(() => new URL(router.resolve({ name: "show", params: { showId: props.show.id } }).href, location.origin).href);

async function loadMembers(): Promise<void> {
  loadingMembers.value = true;
  membersError.value = false;
  try {
    members.value = await props.show.getMembers();
  } catch (error) {
    console.error(error);
    membersError.value = true;
  } finally {
    loadingMembers.value = false;
  }
}

watch(visible, (value) => {
  if (value) {
    inviteEmail.value = "";
    loadMembers();
  }
}, { immediate: true });

function avatarUrl(member: ShowMember): string | undefined {
  return member.avatar ? pb.files.getURL({ collectionName: "users", id: member.id }, member.avatar) : undefined;
}

function initials(member: ShowMember): string {
  return member.name.split(" ").slice(0, 2).map(word => word[0]?.toUpperCase() ?? "").join("") || "?";
}

async function invite(): Promise<void> {
  const email = inviteEmail.value.trim();
  if (!email || inviting.value) {
    return;
  }

  inviting.value = true;
  try {
    members.value = await props.show.addMember(email, inviteRole.value);
    inviteEmail.value = "";
  } catch (error) {
    notifyError("Could not add this person", error);
  } finally {
    inviting.value = false;
  }
}

async function changeRole(member: ShowMember, role: InviteRole): Promise<void> {
  try {
    await props.show.setMemberRole(member.id, role);
    member.role = role;
  } catch (error) {
    notifyError("Could not change the role", error);
  }
}

async function remove(member: ShowMember): Promise<void> {
  try {
    await props.show.removeMember(member.id);
    members.value = members.value.filter(m => m !== member);
  } catch (error) {
    notifyError("Could not remove this person", error);
  }
}

async function setVisibility(value: Visibility): Promise<void> {
  try {
    await props.show.setVisibility(value);
  } catch (error) {
    notifyError("Could not change who can open the show", error);
  }
}

async function copyLink(): Promise<void> {
  await copy(showUrl.value);
  notifySuccess("Link copied");
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="`Share &quot;${show.title}&quot;`"
    class="w-[34rem] max-w-[calc(100vw-2rem)]"
    modal
    dismissable-mask
  >
    <div class="flex flex-col gap-6">
      <form
        v-if="isOwner"
        class="flex flex-wrap gap-2"
        @submit.prevent="invite"
      >
        <InputText
          v-model="inviteEmail"
          type="email"
          placeholder="Add people by email"
          aria-label="Email address"
          class="min-w-48 flex-1"
        />
        <Select
          v-model="inviteRole"
          :options="ROLE_OPTIONS"
          option-label="label"
          option-value="value"
          aria-label="Role"
          class="w-36"
        />
        <Button
          type="submit"
          label="Add"
          :loading="inviting"
          :disabled="!inviteEmail.trim()"
        />
      </form>

      <div class="flex flex-col gap-1">
        <span
          id="share-members-label"
          class="text-sm font-medium text-muted-color"
        >People with access</span>
        <Message
          v-if="membersError"
          severity="warn"
          size="small"
        >
          The list of people could not be loaded.
        </Message>
        <ul aria-labelledby="share-members-label">
          <li
            v-for="member in members"
            :key="member.id"
            class="flex items-center gap-3 py-1.5"
          >
            <Avatar
              :image="avatarUrl(member)"
              :label="avatarUrl(member) ? undefined : initials(member)"
              shape="circle"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">
                {{ member.name || member.email || "Unnamed" }}<span
                  v-if="member.id === auth.user?.id"
                  class="font-normal text-muted-color"
                > (you)</span>
              </div>
              <div
                v-if="member.email && member.name"
                class="truncate text-sm text-muted-color"
              >
                {{ member.email }}
              </div>
            </div>
            <template v-if="isOwner && member.role !== 'owner'">
              <Select
                :model-value="member.role"
                :options="ROLE_OPTIONS"
                option-label="label"
                option-value="value"
                :aria-label="`Role of ${member.name}`"
                size="small"
                class="w-32"
                @update:model-value="changeRole(member, $event)"
              />
              <Button
                icon="pi pi-times"
                severity="secondary"
                size="small"
                :aria-label="`Remove ${member.name}`"
                text
                rounded
                @click="remove(member)"
              />
            </template>
            <span
              v-else
              class="pr-3 text-sm text-muted-color"
            >{{ { owner: "Owner", editor: "Can edit", viewer: "Can view" }[member.role] }}</span>
          </li>
        </ul>
      </div>

      <div class="flex flex-col gap-2">
        <span
          id="share-visibility-label"
          class="text-sm font-medium text-muted-color"
        >General access</span>
        <div class="flex items-center gap-3">
          <span class="flex size-10 flex-none items-center justify-center rounded-full bg-primary/15 text-primary">
            <i
              :class="`pi ${visibility.icon}`"
              aria-hidden="true"
            />
          </span>
          <div class="flex min-w-0 flex-1 flex-col items-start gap-1">
            <Select
              v-if="isOwner"
              :model-value="show.permissions.visibility"
              :options="VISIBILITY_OPTIONS"
              option-label="label"
              option-value="value"
              aria-labelledby="share-visibility-label"
              size="small"
              @update:model-value="setVisibility($event)"
            />
            <span
              v-else
              class="font-medium"
            >{{ visibility.label }}</span>
            <span class="text-sm text-muted-color">{{ visibility.description }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <Button
          label="Copy link"
          icon="pi pi-link"
          severity="secondary"
          outlined
          @click="copyLink"
        />
        <Button
          label="Done"
          @click="visible = false"
        />
      </div>
    </template>
  </Dialog>
</template>
