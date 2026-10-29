import { MEMORY_CATEGORY_LABELS, memoryCategory, type Memory } from '../../types/memory';

/** Plain JSON the user can keep or move to another device. Only fields the user entered are included. */
export function buildMemoryExport(memories: Memory[], now = new Date()): string {
  return JSON.stringify(
    {
      app: 'OpenEyes AI',
      exportedAt: now.toISOString(),
      memories: memories.map((m) => ({
        text: m.text,
        category: MEMORY_CATEGORY_LABELS[memoryCategory(m)],
        ...(m.subject ? { item: m.subject } : {}),
        ...(m.dueAt ? { due: m.dueAt } : {}),
        ...(m.done !== undefined ? { done: m.done } : {}),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    },
    null,
    2,
  );
}

export function downloadMemoryExport(memories: Memory[]): void {
  const blob = new Blob([buildMemoryExport(memories)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `openeyes-memories-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
