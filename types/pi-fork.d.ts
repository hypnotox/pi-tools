import type { EntryRenderer } from "@earendil-works/pi-coding-agent";

declare module "@earendil-works/pi-coding-agent" {
  interface EntryRendererRegistrationOptions {
    spacingBefore?: number;
  }

  interface ExtensionAPI {
    registerEntryRenderer<T = unknown>(
      customType: string,
      renderer: EntryRenderer<T>,
      options?: EntryRendererRegistrationOptions,
    ): void;
  }
}
