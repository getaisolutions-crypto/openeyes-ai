/** Turns a spoken or typed phrase into an Explore action. Anything unrecognized is a question about the view. */

export type ExploreCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'repeat' }
  | { type: 'read' }
  | { type: 'remember' }
  | { type: 'find'; object: string }
  | { type: 'ask'; question: string; about: 'current' | 'previous' };

const clean = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^(hey |ok |okay )?open ?eyes[,.!]?\s*/, '')
    .replace(/[.!?,]+$/g, '')
    .trim();

/** Past-tense questions refer to earlier observations, so the earlier photo is reused instead of taking a new one. */
const PAST_QUESTION = /\b(was|were|did|earlier|before|previous(ly)?|last time|a moment ago)\b/;

export function parseExploreCommand(input: string): ExploreCommand | null {
  const raw = input.trim();
  if (!raw) return null;
  const text = clean(raw);
  if (!text) return null;

  if (/^(stop|stop exploring|stop it|end( exploring)?|quit|cancel|turn off( the)? camera)$/.test(text)) return { type: 'stop' };
  if (/^(pause|pause exploring|hold on|wait|be quiet|quiet)$/.test(text)) return { type: 'pause' };
  if (/^(keep exploring|resume|continue|carry on|keep going|resume exploring|continue exploring)$/.test(text)) return { type: 'resume' };
  if (/^(start exploring|explore|explore (what'?s|what is) around me|explore around me|what'?s around me|what is around me|describe (my )?surroundings|look around)$/.test(text)) {
    return { type: 'start' };
  }
  if (/^(describe (that|it|this) again|say (that|it) again|repeat( that)?|again|what did you say)$/.test(text)) return { type: 'repeat' };
  if (/^(read( that| this| the)?( sign| text| label| page)?( for me)?|what does (it|that|the sign|this) say)$/.test(text)) return { type: 'read' };
  if (/^(remember (this|that)|save (this|that)( as a memory)?)$/.test(text)) return { type: 'remember' };

  const find = text.match(/^(?:find|where (?:is|are)|look for|help me find|can you see) (?:my |the |a |an )?(.{1,80})$/);
  if (find && !/\b(left|right|front)\b/.test(find[1])) return { type: 'find', object: find[1].trim() };

  return { type: 'ask', question: raw, about: PAST_QUESTION.test(text) ? 'previous' : 'current' };
}
