/**
 * Form-bridge types — the contract that lets the copilot pre-fill the form the
 * user has open on screen (for review before saving; nothing is written on the
 * server). Shared between the client store, the widget, and the API route.
 */
export type FormFieldType = "text" | "textarea" | "date" | "select";

export type FormFieldOption = { value: string; label: string };

export type FormField = {
  /** Field name as understood by the form (the key passed to `apply`). */
  name: string;
  label: string;
  type: FormFieldType;
  /** Extra guidance for the model (format, meaning). */
  description?: string;
  /** For `select`: the allowed value/label pairs. */
  options?: FormFieldOption[];
};

/** What the client tells the server about the open form (no `apply`). */
export type FormDescriptor = { key: string; title: string; fields: FormField[] };

/** The registered bridge — descriptor + the client-side apply function. */
export type FormBridge = FormDescriptor & {
  apply: (values: Record<string, string>) => void;
};
