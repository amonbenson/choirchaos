import { pb } from ".";

export async function login(usernameOrEmail: string, password: string) {
  return await pb.collection("users").authWithPassword(usernameOrEmail, password);
}

export async function logout() {
  pb.authStore.clear();
}

export function isLoggedIn() {
  return !!pb.authStore.token;
}
