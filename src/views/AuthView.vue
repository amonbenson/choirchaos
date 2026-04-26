<script setup lang="ts">
import Button from "primevue/button";
import Divider from "primevue/divider";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Password from "primevue/password";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { login, loginWithOAuth2, register } from "@/pocketbase/auth";

const router = useRouter();
const route = useRoute();

const redirectTarget = (): string | { name: string } =>
  (route.query.redirect as string | undefined) ?? { name: "home" };

const tab = ref<"login" | "register">("login");

const name = ref("");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

watch(tab, () => {
  error.value = null;
});

async function handleLogin(): Promise<void> {
  error.value = null;
  loading.value = true;
  try {
    await login(email.value, password.value);
    router.push(redirectTarget());
  } catch {
    error.value = "Invalid email or password.";
  } finally {
    loading.value = false;
  }
}

async function handleRegister(): Promise<void> {
  if (password.value !== confirmPassword.value) {
    error.value = "Passwords do not match.";
    return;
  }

  error.value = null;
  loading.value = true;
  try {
    await register(name.value, email.value, password.value);
    router.push(redirectTarget());
  } catch (e: any) {
    error.value = e?.response?.message ?? "Registration failed.";
  } finally {
    loading.value = false;
  }
}

async function handleGoogle(): Promise<void> {
  error.value = null;
  loading.value = true;
  try {
    await loginWithOAuth2("google");
    router.push(redirectTarget());
  } catch {
    error.value = "Google sign-in failed or was cancelled.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex size-full items-center justify-center p-4">
    <div class="w-full max-w-sm">
      <Tabs v-model:value="tab">
        <TabList>
          <Tab value="login">
            Sign In
          </Tab>
          <Tab value="register">
            Create Account
          </Tab>
        </TabList>

        <TabPanels>
          <!-- Sign In -->
          <TabPanel value="login">
            <div class="flex flex-col gap-4 py-4">
              <!-- <Button
                label="Continue with Google"
                severity="secondary"
                icon="pi pi-google"
                :loading="loading"
                fluid
                @click="handleGoogle"
              />

              <Divider>OR</Divider> -->

              <div class="flex flex-col gap-2">
                <label for="login-email">Email</label>
                <InputText
                  id="login-email"
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  fluid
                  @keyup.enter="handleLogin"
                />
              </div>

              <div class="flex flex-col gap-2">
                <label for="login-password">Password</label>
                <Password
                  v-model="password"
                  input-id="login-password"
                  :feedback="false"
                  autocomplete="current-password"
                  fluid
                  toggle-mask
                  @keyup.enter="handleLogin"
                />
              </div>

              <Message
                v-if="error"
                severity="error"
              >
                {{ error }}
              </Message>

              <Button
                class="mt-4"
                label="Sign In"
                :loading="loading"
                fluid
                @click="handleLogin"
              />
            </div>
          </TabPanel>

          <!-- Register -->
          <TabPanel value="register">
            <div class="flex flex-col gap-4 py-4">
              <!-- <Button
                label="Continue with Google"
                severity="secondary"
                icon="pi pi-google"
                :loading="loading"
                fluid
                @click="handleGoogle"
              />

              <Divider>OR</Divider> -->

              <div class="flex flex-col gap-2">
                <label for="register-name">Name</label>
                <InputText
                  id="register-name"
                  v-model="name"
                  autocomplete="name"
                  fluid
                />
              </div>

              <div class="flex flex-col gap-2">
                <label for="register-email">Email</label>
                <InputText
                  id="register-email"
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  fluid
                />
              </div>

              <div class="flex flex-col gap-2">
                <label for="register-password">Password</label>
                <Password
                  v-model="password"
                  input-id="register-password"
                  autocomplete="new-password"
                  fluid
                  toggle-mask
                />
              </div>

              <div class="flex flex-col gap-2">
                <label for="register-confirm">Confirm Password</label>
                <Password
                  v-model="confirmPassword"
                  input-id="register-confirm"
                  :feedback="false"
                  autocomplete="new-password"
                  fluid
                  toggle-mask
                  @keyup.enter="handleRegister"
                />
              </div>

              <Message
                v-if="error"
                severity="error"
              >
                {{ error }}
              </Message>

              <Button
                class="mt-4"
                label="Create Account"
                :loading="loading"
                fluid
                @click="handleRegister"
              />
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  </div>
</template>
