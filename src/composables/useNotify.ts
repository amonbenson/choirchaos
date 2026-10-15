import { ClientResponseError } from "pocketbase";
import { useToast } from "primevue/usetoast";

const TOAST_LIFETIME_MS = 5000;

export function getErrorMessage(error: unknown): string {
  if (error instanceof ClientResponseError) {
    const fieldMessages = Object.values(error.response?.data ?? {})
      .map((field: any) => field?.message)
      .filter(Boolean);
    return [error.response?.message || error.message, ...fieldMessages].join(" ");
  }

  return error instanceof Error ? error.message : String(error);
}

export function useNotify(): {
  notifyError: (summary: string, error: unknown) => void;
  notifySuccess: (summary: string, detail?: string) => void;
} {
  const toast = useToast();

  function notifyError(summary: string, error: unknown): void {
    console.error(error);
    toast.add({ severity: "error", summary, detail: getErrorMessage(error), life: TOAST_LIFETIME_MS });
  }

  function notifySuccess(summary: string, detail?: string): void {
    toast.add({ severity: "success", summary, detail, life: TOAST_LIFETIME_MS });
  }

  return { notifyError, notifySuccess };
}
