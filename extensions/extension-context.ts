export function extensionContext(source: string, content: string): string {
  return `<extension-context source="pi-tools/${source}">\n${content}\n</extension-context>`;
}
