import OpenAI from 'openai';
import { env } from '../env.js';

export type Intent = 'question' | 'issue' | 'suggestion' | 'casual' | 'staff_request' | 'unknown';
export type Classification = {
  intent: Intent;
  confidence: number;
  shouldRespond: boolean;
  topic: string;
  rationale: string;
  normalizedQuestion: string;
  searchTerms: string[];
  relatedTopics: string[];
};

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

const stopWords = new Set([
  'a','an','and','are','as','at','be','been','but','by','can','could','did','do','does','for','from','had','has','have','how','i','if','in','is','it','me','my','of','on','or','so','that','the','their','them','then','there','they','this','to','was','we','were','what','when','where','which','who','why','will','with','would','you','your'
]);

const domainExpansions: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /\b(die|died|dead|death|respawn|revive|inventory|items?|stuff|belongings|gear|weapon|gun|loot)\b/i, terms: ['death', 'respawn', 'revive', 'NLR', 'new life rule', 'return to scene', 'inventory recovery', 'dropped items', 'belongings'] },
  { pattern: /\b(car|cars|vehicle|vehicles|garage|garages|impound|tow|stored|retrieve)\b/i, terms: ['vehicle', 'garage', 'impound', 'vehicle retrieval', 'stored vehicle'] },
  { pattern: /\b(radio|channel|frequency|tomm?y|tRadio)\b/i, terms: ['radio', 'Tommy Radio', 'tRadio', 'radio channel', 'frequency'] },
  { pattern: /\b(phone|call|text|message|app)\b/i, terms: ['phone', 'phone app', 'calling', 'messaging'] },
  { pattern: /\b(bank|banking|money|cash|account|transfer|paycheck|payment)\b/i, terms: ['banking', 'money', 'account', 'payment', 'transfer'] },
  { pattern: /\b(police|cop|leo|lspd|bcso|lcso|sasp|sheriff|trooper)\b/i, terms: ['LEO', 'police', 'law enforcement', 'department procedure'] },
  { pattern: /\b(ems|medic|ambulance|fire|firefighter|hospital|medical)\b/i, terms: ['EMS', 'medical', 'revive', 'hospital', 'Fire EMS'] },
  { pattern: /\b(job|jobs|work|business|businesses|employee|boss)\b/i, terms: ['jobs', 'businesses', 'employment'] },
  { pattern: /\b(house|housing|home|property|apartment)\b/i, terms: ['housing', 'property', 'home'] },
  { pattern: /\b(command|commands|slash|\/\w+)\b/i, terms: ['commands', 'server command'] }
];

function unique(values: string[], max = 20) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, max);
}

function fallback(content: string): Classification {
  const text = content.toLowerCase();
  const trimmed = text.trim();
  const conversationalReply = /^(have you tried|did you try|try\b|maybe\s+(?:try|check|look|go)\b|check\s+(?:at|the)\b|you\s+(?:could|can|should)\s+(?:try|check|look|go|ask|restart)\b|probably\b|might be\b)/i.test(trimmed);
  const directedAtPlayer = /^<@!?\d+>\s*/.test(content.trim());
  const issue = /(anyone else|issue|bug|broken|not working|doesn['’]?t work|won['’]?t work|error|crash|crashing|stuck|can['’]?t|unable)/i.test(text);
  const suggestion = /(suggest|suggestion|idea|would be cool|should add|could (you|we) add|wish (we|you)|it would be nice)/i.test(text);
  const question = /\?$/.test(trimmed) || /^(how|what|where|when|why|who|can|could|is|are|do|does|did|will|would)\b/i.test(trimmed);
  const informationQuestion = /^(how|what|where|when|why|who)\b/i.test(trimmed);

  const rawTerms = text
    .replace(/[^a-z0-9/_-]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
  const expanded: string[] = [...rawTerms];
  for (const entry of domainExpansions) {
    if (entry.pattern.test(content)) expanded.push(...entry.terms);
  }

  const base = conversationalReply || directedAtPlayer
    ? { intent: 'casual' as const, confidence: 0.82, shouldRespond: false, topic: 'player conversation', rationale: 'Player-to-player reply, suggestion, or troubleshooting.' }
    : issue && !informationQuestion
      ? { intent: 'issue' as const, confidence: 0.72, shouldRespond: true, topic: 'possible issue', rationale: 'Rule-based issue pattern.' }
    : suggestion
      ? { intent: 'suggestion' as const, confidence: 0.70, shouldRespond: false, topic: 'possible suggestion', rationale: 'Rule-based suggestion pattern.' }
      : question
        ? { intent: 'question' as const, confidence: 0.68, shouldRespond: true, topic: rawTerms.slice(0, 4).join(' ') || 'question', rationale: 'Rule-based question pattern.' }
        : { intent: 'casual' as const, confidence: 0.62, shouldRespond: false, topic: 'casual', rationale: 'No support intent detected.' };

  return {
    ...base,
    normalizedQuestion: content.trim(),
    searchTerms: unique(expanded),
    relatedTopics: unique(expanded.filter(term => term.includes(' ') || /^[A-Z]{2,}$/.test(term)), 10)
  };
}

export async function classifyMessage(content: string): Promise<Classification> {
  if (!client || !env.AI_ENABLED) return fallback(content);

  try {
    const response = await client.responses.create({
      model: env.AI_CLASSIFIER_MODEL,
      reasoning: { effort: 'low' },
      instructions: `Classify a FiveM roleplay Discord message and also create a retrieval plan. Return ONLY compact JSON with keys intent, confidence, shouldRespond, topic, rationale, normalizedQuestion, searchTerms, relatedTopics. intent must be one of: question, issue, suggestion, casual, staff_request, unknown. The input may contain labeled CURRENT REQUEST, REPLIED-TO MESSAGE, MOST RECENT MESSAGE, and EARLIER CONTEXT sections. Always treat CURRENT REQUEST as the user's actual request. If CURRENT REQUEST contains a vague reference such as "this", "that", "are they right", "clarify that", or "verify this", resolve it from REPLIED-TO MESSAGE first, otherwise MOST RECENT MESSAGE, and use EARLIER CONTEXT only when needed. Do not let unrelated older messages override the current request's intent. normalizedQuestion MUST be one concise resolved question or request, maximum 220 characters, with no Discord mentions, usernames, transcript labels, or copied conversation dump.

RESPONSE GATE:
- Set shouldRespond=true for a standalone factual server/community question intended for general help, a clear issue report, a clear suggestion submission, or a request directed to the bot.
- Classify player-to-player answers, speculative suggestions, and troubleshooting such as "have you tried at Lester's?", "maybe check the shop", or "try restarting" as casual with shouldRespond=false.
- Also use casual/false for conversational follow-ups, questions aimed at a named or mentioned player, and messages inside an active player conversation unless the bot is directly addressed or the message independently and clearly reports an issue or suggestion.
- Do not classify an information question as an issue merely because it says an item "doesn't do anything". If the main request asks where or how to obtain/use something, keep it a question unless the player clearly reports expected functionality failing.

Detect indirect questions, casual issue reports such as "anyone else having this problem?", and casual suggestions even when explicit keywords are absent. For questions, infer what the player is actually trying to do, not only the words they used. Expand implied concepts and common roleplay/server terminology. Example: "can i collect my inventory when i die" should include concepts such as death, respawn, NLR/new life rule, returning to scene, inventory recovery, dropped items, belongings. searchTerms should contain 4-15 concise retrieval terms/phrases and relatedTopics should contain 1-8 broader concepts. Do not invent a server rule or answer; only expand retrieval meaning. confidence must be 0 to 1.`,
      input: content,
      max_output_tokens: 320
    });
    const jsonText = response.output_text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonText) as Partial<Classification>;
    if (!parsed.intent || typeof parsed.confidence !== 'number') return fallback(content);

    const fallbackPlan = fallback(content);
    return {
      intent: parsed.intent as Intent,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      shouldRespond: Boolean(parsed.shouldRespond),
      topic: String(parsed.topic || fallbackPlan.topic || 'unknown'),
      rationale: String(parsed.rationale || ''),
      normalizedQuestion: String(parsed.normalizedQuestion || content).trim(),
      searchTerms: unique(Array.isArray(parsed.searchTerms) ? parsed.searchTerms.map(String) : fallbackPlan.searchTerms),
      relatedTopics: unique(Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics.map(String) : fallbackPlan.relatedTopics, 10)
    };
  } catch (error) {
    console.error('[classifier] AI classification failed; using fallback', error);
    return fallback(content);
  }
}
