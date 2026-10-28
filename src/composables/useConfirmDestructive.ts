import { useConfirm } from "primevue/useconfirm";

export type DestructiveConfirmation = {
  header: string;
  message: string;
  /** The label of the button that goes ahead, which names the action ("Delete song"). */
  accept: string;
};

/** Asks before a destructive action. Resolves true once the user goes ahead, false when they cancel or close the dialog. */
export function useConfirmDestructive(): (confirmation: DestructiveConfirmation) => Promise<boolean> {
  const confirm = useConfirm();

  return ({ header, message, accept }) => new Promise((resolve) => {
    confirm.require({
      header,
      message,
      icon: "pi pi-exclamation-triangle",
      rejectProps: { label: "Cancel", severity: "secondary", text: true },
      acceptProps: { label: accept, severity: "danger" },
      accept: () => resolve(true),
      reject: () => resolve(false),
      onHide: () => resolve(false),
    });
  });
}
