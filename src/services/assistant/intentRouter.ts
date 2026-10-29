import type { MemoryInput } from '../../types/memory';
import { parseRememberRequest } from '../ai/conversationContext';
import { normalizeItem } from '../find/objectSearch';
import { parseReminderRequest, parseWhereIsQuestion } from '../memory/memoryIntent';
import { parseTaskCommand, parseTaskRequest, type TaskCommand } from '../tasks/taskSession';

export type Intent =
  | { kind: 'task-command'; command: TaskCommand }
  | { kind: 'remember'; note: string }
  | { kind: 'reminder'; input: MemoryInput }
  | { kind: 'where-is'; item: string }
  | { kind: 'find'; item: string }
  | { kind: 'read' }
  | { kind: 'explore' }
  | { kind: 'task'; task: string }
  | { kind: 'chat' };

export interface RouteContext {
  /** A guided task is waiting for an answer or running. */
  taskActive: boolean;
  /** A photo is attached, so the question is about that photo and stays in the conversation. */
  hasPhoto: boolean;
  now?: Date;
}

const PREFIX = '^(?:hey\\s+)?(?:openeyes,?\\s+)?(?:please\\s+|can you\\s+|could you\\s+)?';

const FIND = new RegExp(
  `${PREFIX}(?:help me (?:to )?find|find|look for|search for|locate|can you see|do you see|where'?s|where is) (?:my|the|a|an|our) (.+?)[?.!]*$`,
  'i',
);
const READ = new RegExp(
  `${PREFIX}(?:read (?:this|that|it|the|my|a)\\b|what(?:'s| is| does it say) (?:written|printed)|what does (?:this|the) (?:sign|label|letter|menu) say|what'?s the (?:expir(?:y|ation) date|best before|use by date))`,
  'i',
);
const EXPLORE = new RegExp(
  `${PREFIX}(?:what'?s around me|what is around me|describe (?:the room|my surroundings|where i am|around me)|look around|explore)\\b`,
  'i',
);

/**
 * Explicit rules route clear requests to the matching feature. Anything else stays a normal conversation,
 * where Meta AI answers.
 */
export function routeIntent(text: string, ctx: RouteContext): Intent {
  const t = text.trim();
  if (ctx.taskActive) {
    const command = parseTaskCommand(t);
    if (command) return { kind: 'task-command', command };
  }
  const note = parseRememberRequest(t);
  if (note) return { kind: 'remember', note };
  const reminder = parseReminderRequest(t, ctx.now);
  if (reminder) return { kind: 'reminder', input: reminder };
  const remembered = parseWhereIsQuestion(t);
  if (remembered && /\b(leave|left|put|placed)\b/i.test(t)) return { kind: 'where-is', item: remembered };
  if (!ctx.hasPhoto) {
    const find = t.match(FIND);
    if (find) {
      const item = normalizeItem(find[1]).toLowerCase();
      if (item) return { kind: 'find', item };
    }
    if (READ.test(t)) return { kind: 'read' };
    if (EXPLORE.test(t)) return { kind: 'explore' };
  }
  if (remembered) return { kind: 'where-is', item: remembered };
  const task = parseTaskRequest(t);
  if (task && !/^(find|locate|look|search|read)\b/i.test(task)) return { kind: 'task', task };
  return { kind: 'chat' };
}
