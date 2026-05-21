export const memoryExtensionTestRoots = [
  "extensions/memory-core",
  "extensions/memory-lancedb",
  "extensions/memory-wiki",
  "extensions/personal-memory",
];

export function isMemoryExtensionRoot(root) {
  return memoryExtensionTestRoots.includes(root);
}
