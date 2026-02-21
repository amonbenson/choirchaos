import type { RecordAuthResponse, RecordModel } from "pocketbase";

import { pb } from ".";

export async function login(usernameOrEmail: string, password: string): Promise<RecordAuthResponse<RecordModel>> {
  return await pb.collection("users").authWithPassword(usernameOrEmail, password);
}

export async function logout(): Promise<void> {
  pb.authStore.clear();
}

export function isLoggedIn(): boolean {
  return !!pb.authStore.token;
}
