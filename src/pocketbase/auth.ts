import type { RecordAuthResponse, RecordModel } from "pocketbase";

import { pb } from ".";

export async function login(usernameOrEmail: string, password: string): Promise<RecordAuthResponse<RecordModel>> {
  return await pb.collection("users").authWithPassword(usernameOrEmail, password);
}

export async function register(name: string, email: string, password: string): Promise<RecordAuthResponse<RecordModel>> {
  await pb.collection("users").create({ name, email, password, passwordConfirm: password });
  return login(email, password);
}

export async function loginWithOAuth2(provider: string): Promise<void> {
  await pb.collection("users").authWithOAuth2({ provider });
}

export async function logout(): Promise<void> {
  pb.authStore.clear();
}

export function isLoggedIn(): boolean {
  return !!pb.authStore.token;
}

export type Permissions = {
  owner?: string;
  editors: string[];
  viewers: string[];
  visibility: "private" | "unlisted" | "public";
};

export const NoPermissions: Permissions = Object.freeze({
  owner: undefined,
  editors: [],
  viewers: [],
  visibility: "private",
});

export type UserAccess = {
  owner: boolean;
  editor: boolean;
  viewer: boolean;
};

export const NoAccess: UserAccess = Object.freeze({
  owner: false,
  editor: false,
  viewer: false,
});

export function getAccessFlags(context: Partial<Permissions>, userId?: string): UserAccess {
  // Use the logged in user if no explicit id was provided
  const resolvedUserId = userId ?? pb.authStore.record?.id;

  // Extract the context fields with defaults
  const {
    owner,
    editors = [],
    viewers = [],
    visibility = "private",
  } = context;

  const isImplicitViewer = ["unlisted", "public"].includes(visibility);

  // Get the permissions for a guest user
  if (!resolvedUserId) {
    return {
      owner: false,
      editor: false,
      viewer: isImplicitViewer,
    };
  }

  // Get explicit permissions for the provided user
  const isOwner = owner === resolvedUserId;
  const isEditor = editors.includes(resolvedUserId);
  const isExplicitViewer = viewers.includes(resolvedUserId);

  // Return the access flags
  return {
    owner: isOwner,
    editor: isOwner || isEditor,
    viewer: isOwner || isEditor || isImplicitViewer || isExplicitViewer,
  };
}
