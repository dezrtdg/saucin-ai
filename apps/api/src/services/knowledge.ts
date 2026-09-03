import crypto from 'node:crypto';
import OpenAI from 'openai';
import { db } from '../db.js';
import { env } from '../env.js';

export type KnowledgeQueryPlan = {
  original: string;
  normalizedQuestion?: string;
  topic?: string;
  searchTerms?: string[];
  relatedTopics?: string[];
};

export type KnowledgeHit = {
  id: number;
  title: string;
  body: string;
  category: string;
  audiences: string[];
  aliases: string[];
  related_topics: string[];
  example_questions: string[];
  score: number;
  rank: number;
  match_types: string[];
};

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

function unique(values: string[], max = 40) {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))].slice(0, max);
}

function articleEmbeddingText(row: {
  title: string;
  body: string;
  content_type?: string | null;
  category: string;
  aliases?: string[] | null;
  related_topics?: string[] | null;
  example_questions?: string[] | null;
}) {
  return [
    `Title: ${row.title}`,
    row.content_type ? `Content type: ${row.content_type}` : '',
    `Category: ${row.category}`,
    row.aliases?.length ? `Aliases and player wording: ${row.aliases.join(', ')}` : '',
    row.related_topics?.length ? `Related topics: ${row.related_topics.join(', ')}` : '',
    row.example_questions?.length ? `Example player questions:\n${row.example_questions.join('\n')}` : '',
    `Verified information:\n${row.body}`
  ].filter(Boolean).join('\n\n').slice(0, 24000);
}

async function createEmbedding(input: string): Promise<number[] | null> {
  if (!client || !env.AI_ENABLED || !input.trim()) return null;
  try {
    const response = await client.embeddings.create({
      model: env.AI_EMBEDDING_MODEL,
      input: input.slice(0, 24000),
      encoding_format: 'float'
    });
    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.error('[knowledge] embedding request failed', error);
    return null;
  }
}

export async function refreshKnowledgeEmbedding(articleId: number): Promise<boolean> {
  const result = await db.query(
    `SELECT id,title,body,content_type,category,aliases,related_topics,example_questions
       FROM knowledge_articles WHERE id=$1`,
    [articleId]
  );
  if (!result.rowCount) return false;
  const row = result.rows[0];
  const embedding = await createEmbedding(articleEmbeddingText(row));
  if (!embedding) return false;
  await db.query(
    `UPDATE knowledge_articles SET embedding=$1::vector, embedding_updated_at=NOW() WHERE id=$2`,
    [JSON.stringify(embedding), articleId]
  );
  return true;
}

export async function backfillKnowledgeEmbeddings(limit = 200): Promise<number> {
  if (!client || !env.AI_ENABLED) return 0;
  const result = await db.query(
    `SELECT id,title,body,content_type,category,aliases,related_topics,example_questions
       FROM knowledge_articles
      WHERE embedding IS NULL
      ORDER BY updated_at DESC
      LIMIT $1`,
    [limit]
  );
  if (!result.rowCount) return 0;

  let indexed = 0;
  const sql = `UPDATE knowledge_articles SET embedding=$1::vector, embedding_updated_at=NOW() WHERE id=$2`;
  try {
    for (let start = 0; start < result.rows.length; start += 32) {
      const batch = result.rows.slice(start, start + 32);
      const response = await client.embeddings.create({
        model: env.AI_EMBEDDING_MODEL,
        input: batch.map(articleEmbeddingText),
        encoding_format: 'float'
      });
      for (let i = 0; i < batch.length; i++) {
        const embedding = response.data[i]?.embedding;
        if (embedding) {
          await db.query(sql, [JSON.stringify(embedding), batch[i].id]);
          indexed++;
        }
      }
    }
    console.log(`[knowledge] indexed ${indexed} article embedding(s)`);
    return indexed;
  } catch (error) {
    console.error('[knowledge] background embedding index failed', error);
    return indexed;
  }
}

export async function getAllowedKnowledgeAudiences(discordRoleIds: string[] = []): Promise<string[]> {
  const result = await db.query(
    `SELECT DISTINCT a.key
       FROM knowledge_audiences a
       LEFT JOIN knowledge_audience_roles ar ON ar.audience_key = a.key
      WHERE a.enabled = TRUE
        AND (a.public_access = TRUE OR ar.discord_role_id = ANY($1::text[]))
      ORDER BY a.key`,
    [discordRoleIds]
  );
  return result.rows.map(row => String(row.key));
}

function buildSearchText(plan: KnowledgeQueryPlan) {
  return unique([
    plan.original,
    plan.normalizedQuestion || '',
    plan.topic || '',
    ...(plan.searchTerms || []),
    ...(plan.relatedTopics || [])
  ], 30).join(' ');
}

function searchableRowText(row: any) {
  return [
    row.title,
    row.body,
    row.content_type || '',
    row.category,
    ...(row.aliases || []),
    ...(row.related_topics || []),
    ...(row.example_questions || [])
  ].join(' ').toLowerCase();
}

export async function searchKnowledge(plan: KnowledgeQueryPlan, allowedAudiences: string[], limit = 8): Promise<KnowledgeHit[]> {
  if (!allowedAudiences.length) return [];

  const expandedQuery = buildSearchText(plan);
  const queryEmbedding = await createEmbedding([
    plan.normalizedQuestion || plan.original,
    plan.topic ? `Topic: ${plan.topic}` : '',
    plan.searchTerms?.length ? `Concepts: ${plan.searchTerms.join(', ')}` : '',
    plan.relatedTopics?.length ? `Related: ${plan.relatedTopics.join(', ')}` : ''
  ].filter(Boolean).join('\n'));

  const params: unknown[] = [allowedAudiences, expandedQuery, plan.original];
  let semanticSelect = 'NULL::float AS semantic_score';
  if (queryEmbedding) {
    params.push(JSON.stringify(queryEmbedding));
    semanticSelect = `CASE WHEN embedding IS NULL THEN NULL ELSE GREATEST(-1.0, LEAST(1.0, 1 - (embedding <=> $4::vector))) END::float AS semantic_score`;
  }

  const result = await db.query(
    `SELECT id,title,body,content_type,category,audiences,aliases,related_topics,example_questions,
            ts_rank_cd(
              setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
              setweight(to_tsvector('english', coalesce(body,'')), 'B') ||
              setweight(to_tsvector('english', coalesce(array_to_string(aliases,' '),'')), 'A') ||
              setweight(to_tsvector('english', coalesce(array_to_string(related_topics,' '),'')), 'A') ||
              setweight(to_tsvector('english', coalesce(array_to_string(example_questions,' '),'')), 'A'),
              websearch_to_tsquery('english', $2)
            )::float AS lexical_rank,
            GREATEST(
              similarity(lower(coalesce(title,'')), lower($3)),
              similarity(lower(coalesce(array_to_string(aliases,' '),'')), lower($3)),
              similarity(lower(coalesce(array_to_string(example_questions,' '),'')), lower($3)),
              similarity(lower(coalesce(array_to_string(related_topics,' '),'')), lower($3))
            )::float AS fuzzy_rank,
            ${semanticSelect}
       FROM knowledge_articles
      WHERE status='published'
        AND audiences && $1::text[]
      ORDER BY updated_at DESC
      LIMIT 500`,
    params
  );

  const terms = unique([...(plan.searchTerms || []), ...(plan.relatedTopics || [])], 30).map(term => term.toLowerCase());
  const scored = result.rows.map(row => {
    const lexical = Number(row.lexical_rank || 0);
    const fuzzy = Math.max(0, Number(row.fuzzy_rank || 0));
    const semanticRaw = row.semantic_score == null ? null : Number(row.semantic_score);
    const semantic = semanticRaw == null ? 0 : Math.max(0, Math.min(1, semanticRaw));
    const haystack = searchableRowText(row);
    const termHits = terms.filter(term => term.length > 2 && haystack.includes(term)).length;
    const coverage = terms.length ? Math.min(1, termHits / Math.min(8, terms.length)) : 0;
    const lexicalNorm = Math.min(1, lexical * 3.5);

    const score = queryEmbedding
      ? semantic * 0.58 + lexicalNorm * 0.24 + fuzzy * 0.08 + coverage * 0.10
      : lexicalNorm * 0.62 + fuzzy * 0.18 + coverage * 0.20;

    const matchTypes: string[] = [];
    if (semantic >= 0.58) matchTypes.push('semantic');
    if (lexical > 0) matchTypes.push('keyword');
    if (fuzzy >= 0.18) matchTypes.push('fuzzy');
    if (coverage > 0) matchTypes.push('concept');

    return {
      id: Number(row.id),
      title: String(row.title),
      body: String(row.body),
      category: String(row.category),
      audiences: row.audiences || ['public'],
      aliases: row.aliases || [],
      related_topics: row.related_topics || [],
      example_questions: row.example_questions || [],
      score,
      rank: score,
      match_types: matchTypes
    } satisfies KnowledgeHit;
  });

  const useful = scored
    .filter(hit => hit.score >= (queryEmbedding ? 0.18 : 0.06) || hit.match_types.includes('keyword'))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return useful;
}

export type GroundedReply = { text: string; coverage: 'full' | 'partial' };


function cleanDisplayQuestion(value: string) {
  return String(value || '')
    .replace(/<@!?\d+>/g, ' ')
    .replace(/\b(?:CURRENT REQUEST|REPLIED-TO MESSAGE|MOST RECENT MESSAGE|EARLIER CONTEXT|RECENT CONVERSATION)\b:?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export async function deriveKnowledgeGapQuestion(input: {
  currentRequest: string;
  conversationContext?: string;
  partialAnswer?: string | null;
  topic?: string;
  matchedSources?: unknown[];
  fallback?: string;
}): Promise<string> {
  const fallback = cleanDisplayQuestion(input.fallback || input.currentRequest) || 'What server information is missing here?';
  if (!client || !env.AI_ENABLED) return fallback;

  try {
    const sourceTitles = (input.matchedSources || [])
      .map((source: any) => String(source?.title || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    const response = await client.responses.create({
      model: env.AI_CLASSIFIER_MODEL,
      reasoning: { effort: 'low' },
      instructions: `Identify the SINGLE specific piece of verified server information that is still missing. Return only one concise natural-language question, maximum 180 characters. If a partial answer explicitly identifies an uncovered detail, make that uncovered detail the question. Resolve vague references such as "this", "that", or "clarify that" using the replied-to or most recent relevant conversation context. Do not include Discord mentions, usernames, profanity from unrelated chat, transcript labels, multiple questions, or explanation. Do not invent the answer or a rule.`,
      input: [
        `CURRENT REQUEST: ${input.currentRequest}`,
        input.topic ? `TOPIC: ${input.topic}` : '',
        input.partialAnswer ? `PARTIAL VERIFIED ANSWER: ${input.partialAnswer}` : '',
        sourceTitles.length ? `RELATED SOURCE TITLES: ${sourceTitles.join(' | ')}` : '',
        input.conversationContext ? `CONVERSATION CONTEXT:
${String(input.conversationContext).slice(0, 7000)}` : ''
      ].filter(Boolean).join('\n\n'),
      max_output_tokens: 100
    });
    const derived = cleanDisplayQuestion(response.output_text.trim().replace(/^[-*\s]+/, ''));
    if (!derived || derived.length < 6) return fallback;
    return derived.endsWith('?') ? derived : `${derived}?`;
  } catch (error) {
    console.error('[knowledge] gap question derivation failed', error);
    return fallback;
  }
}

export async function generateGroundedReply(message: string, hits: KnowledgeHit[]): Promise<GroundedReply | null> {
  if (!client || !env.AI_ENABLED || hits.length === 0) return null;

  const context = hits.map((h, i) => [
    `SOURCE ${i + 1}: ${h.title}`,
    h.aliases.length ? `Aliases: ${h.aliases.join(', ')}` : '',
    h.related_topics.length ? `Related topics: ${h.related_topics.join(', ')}` : '',
    h.example_questions.length ? `Example questions: ${h.example_questions.join(' | ')}` : '',
    `Verified information: ${h.body}`
  ].filter(Boolean).join('\n')).join('\n\n');

  const response = await client.responses.create({
    model: env.AI_REPLY_MODEL,
    reasoning: { effort: 'low' },
    instructions: `You are the support bot for ${env.SERVER_NAME}. Answer naturally, confidently, and concisely using ONLY the approved server sources provided. Interpret what the player is actually asking or trying to do, including direct implications of the verified rule. Do not invent commands, rules, locations, features, statuses, punishments, exceptions, thresholds, tests, or procedures.

COVERAGE RULES:
- Use COVERAGE: FULL when the approved sources directly answer the player's actual question at the policy level.
- A rule does NOT need an exhaustive definition, formal test, list of examples, or line-by-line boundary for coverage to be FULL when those details were not asked for.
- Do not volunteer caveats such as "what is not specifically covered" when the player's question is already answered by the verified rule.
- You may make unavoidable logical restatements explicit. Example: if a verified rule says "do not use Discord to avoid active RP", it is safe to explain that moving an active RP interaction to Discord in order to bypass, stop, or escape that RP is not allowed.
- Use COVERAGE: PARTIAL only when the PLAYER'S SPECIFIC QUESTION asks for a material detail the sources do not resolve, such as a specific exception, threshold, punishment, procedure, classification of an ambiguous scenario, or exact boundary that changes the answer.
- For PARTIAL answers, answer the verified portion first and identify only the specific unresolved detail that matters to the question. Do not add unrelated gaps.
- If none of the supplied sources meaningfully support an answer, output exactly NO_VERIFIED_ANSWER.

Put COVERAGE: FULL or COVERAGE: PARTIAL on the first line, followed by the player-facing answer. Never reveal private reasoning.`,
    input: `PLAYER MESSAGE:\n${message}\n\nAPPROVED SOURCES:\n${context}`,
    max_output_tokens: 460
  });

  const text = response.output_text.trim();
  if (!text || text === 'NO_VERIFIED_ANSWER') return null;
  const match = text.match(/^COVERAGE:\s*(FULL|PARTIAL)\s*\n+/i);
  if (!match) return { text, coverage: 'full' };
  const answer = text.slice(match[0].length).trim();
  if (!answer) return null;
  return { text: answer, coverage: match[1].toLowerCase() as 'full' | 'partial' };
}

function normalizeGapQuestion(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export async function recordKnowledgeGap(input: {
  question: string;
  normalizedQuestion?: string;
  displayQuestion?: string;
  topic?: string;
  discordUserId?: string;
  channelId?: string;
  discordMessageId?: number;
  conversationContext?: string;
  partialAnswer?: string | null;
  matchedSources?: unknown[];
}) {
  const displayQuestion = cleanDisplayQuestion(input.displayQuestion || input.normalizedQuestion || input.question) || cleanDisplayQuestion(input.question);
  const normalized = normalizeGapQuestion(displayQuestion || input.normalizedQuestion || input.question);
  const exampleQuestion = cleanDisplayQuestion(input.question).slice(0, 500);
  const topic = String(input.topic || '').trim().slice(0, 160) || null;
  const conversationContext = String(input.conversationContext || '').trim().slice(0, 12000) || null;
  const partialAnswer = String(input.partialAnswer || '').trim().slice(0, 6000) || null;
  const similar = await db.query(
    `SELECT id FROM knowledge_gaps
      WHERE status IN ('open','reviewed')
        AND (
          similarity(normalized_question,$1) >= 0.56
          OR ($2::text IS NOT NULL AND topic=$2 AND similarity(normalized_question,$1) >= 0.34)
        )
      ORDER BY similarity(normalized_question,$1) DESC,last_seen DESC LIMIT 1`,
    [normalized || input.question, topic]
  );
  if (similar.rowCount) {
    await db.query(
      `UPDATE knowledge_gaps SET occurrences=occurrences+1,last_seen=NOW(),display_question=$2,
              matched_sources=$3,discord_user_id=COALESCE($4,discord_user_id),channel_id=COALESCE($5,channel_id),
              discord_message_id=COALESCE($6,discord_message_id),
              conversation_context=COALESCE($7,conversation_context),
              partial_answer=COALESCE($8,partial_answer),
              example_questions=(
                SELECT ARRAY(
                  SELECT candidate FROM (
                    SELECT DISTINCT unnest(knowledge_gaps.example_questions || ARRAY[$1]::text[]) AS candidate
                  ) examples
                  WHERE btrim(candidate) <> ''
                  LIMIT 20
                )
              )
        WHERE id=$9`,
      [
        exampleQuestion,
        displayQuestion,
        JSON.stringify(input.matchedSources || []),
        input.discordUserId || null,
        input.channelId || null,
        input.discordMessageId || null,
        conversationContext,
        partialAnswer,
        similar.rows[0].id
      ]
    );
    return;
  }

  const fingerprint = crypto.createHash('sha256').update(normalized || input.question).digest('hex');
  await db.query(
    `INSERT INTO knowledge_gaps
       (fingerprint,normalized_question,display_question,sample_question,topic,discord_user_id,channel_id,discord_message_id,
        conversation_context,partial_answer,matched_sources,example_questions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (fingerprint) DO UPDATE SET
       occurrences = knowledge_gaps.occurrences + 1,
       last_seen = NOW(),
       display_question = EXCLUDED.display_question,
       discord_message_id = COALESCE(EXCLUDED.discord_message_id, knowledge_gaps.discord_message_id),
       conversation_context = COALESCE(EXCLUDED.conversation_context, knowledge_gaps.conversation_context),
       partial_answer = COALESCE(EXCLUDED.partial_answer, knowledge_gaps.partial_answer),
       matched_sources = EXCLUDED.matched_sources,
       example_questions = (
         SELECT ARRAY(
           SELECT candidate FROM (
             SELECT DISTINCT unnest(knowledge_gaps.example_questions || EXCLUDED.example_questions) AS candidate
           ) examples
           WHERE btrim(candidate) <> ''
           LIMIT 20
         )
       )`,
    [
      fingerprint,
      normalized || input.question,
      displayQuestion,
      input.question,
      topic,
      input.discordUserId || null,
      input.channelId || null,
      input.discordMessageId || null,
      conversationContext,
      partialAnswer,
      JSON.stringify(input.matchedSources || []),
      [exampleQuestion]
    ]
  );
}

export function knowledgeGapReply(hits: KnowledgeHit[]) {
  if (hits.length) {
    return `I found related server information, but the current knowledge base does not specifically answer that detail yet. I’ve flagged it as a knowledge gap for staff rather than guessing.`;
  }
  return `I don’t have verified server information that answers that yet. I’ve flagged it as a knowledge gap for staff rather than guessing.`;
}

export type KnowledgeAuthoringOptions = {
  contentTypes: Array<{ key: string; label: string; description?: string }>;
  categories: Array<{ key: string; label: string; description?: string }>;
  audiences: Array<{ key: string; label: string; description?: string; public_access?: boolean }>;
};

export type KnowledgeDraftSuggestion = {
  title: string;
  body: string;
  content_type: string;
  category: string;
  audiences: string[];
  aliases: string[];
  related_topics: string[];
  example_questions: string[];
  authoring_note: string;
};

function cleanList(values: unknown, max: number, itemMax: number) {
  if (!Array.isArray(values)) return [];
  return unique(values.map(value => String(value).replace(/\s+/g, ' ').trim().slice(0, itemMax)).filter(Boolean), max);
}

function chooseAllowed(value: unknown, allowed: string[], fallback: string) {
  const selected = String(value || '').trim();
  return allowed.includes(selected) ? selected : fallback;
}

export async function buildKnowledgeDraft(input: {
  sourceText: string;
  contentTypeHint?: string;
  categoryHint?: string;
  audienceHints?: string[];
  options: KnowledgeAuthoringOptions;
}): Promise<KnowledgeDraftSuggestion> {
  const sourceText = String(input.sourceText || '').trim();
  if (sourceText.length < 8) throw new Error('Provide more verified information before asking AI to build the article.');
  if (!client || !env.AI_ENABLED) throw new Error('AI authoring is unavailable because AI is disabled or no OpenAI API key is configured.');

  const contentTypeKeys = input.options.contentTypes.map(row => row.key);
  const categoryKeys = input.options.categories.map(row => row.key);
  const audienceKeys = input.options.audiences.map(row => row.key);
  const fallbackContentType = contentTypeKeys.includes(input.contentTypeHint || '') ? String(input.contentTypeHint) : (contentTypeKeys[0] || 'other');
  const fallbackCategory = categoryKeys.includes(input.categoryHint || '') ? String(input.categoryHint) : (categoryKeys[0] || 'general');
  const validAudienceHints = unique((input.audienceHints || []).filter(key => audienceKeys.includes(key)), 20);
  const fallbackAudiences = validAudienceHints.length ? validAudienceHints : (audienceKeys.includes('public') ? ['public'] : audienceKeys.slice(0, 1));

  const response = await client.responses.create({
    model: env.AI_REPLY_MODEL,
    reasoning: { effort: 'low' },
    instructions: `You are an editorial assistant for ${env.SERVER_NAME}'s verified knowledge base. Build a structured DRAFT article from staff-supplied verified information. Return ONLY compact JSON with keys: title, body, content_type, category, audiences, aliases, related_topics, example_questions, authoring_note.

SAFETY / ACCURACY RULES:
- The supplied text is the ONLY authority for policy facts. Do not invent rules, punishments, exceptions, commands, procedures, locations, requirements, guarantees, priority levels, enforcement actions, formal thresholds, or tests.
- body should make the supplied rule as clear and decision-ready as possible while preserving its meaning. You MAY make direct logical implications explicit when they are unavoidable restatements of the supplied rule, but you must not create a new policy fact.
- For server_rule and discord_rule content, prefer a concise operational structure when useful: the rule itself, what it means in practice, what is prohibited/required, and any exception that is explicitly supported by the supplied text.
- Example of a SAFE clarification: source says "Do not use Discord messages or DMs to avoid an ongoing RP situation." The body may explicitly state that using Discord to bypass, stop, escape, or move away from that active RP for the purpose of avoiding it is not allowed.
- Example of an UNSAFE invention: source says "No harassment." Do NOT invent a formal harassment test, number of messages, punishment, protected categories, or a precise threshold unless staff supplied it.
- If the supplied text contains a clear exception, make that exception explicit. If it does not contain one, do not create one.
- If the source is already clear enough to answer a normal player question, do not weaken it by adding unnecessary uncertainty language.
- aliases, related_topics, and example_questions are RETRIEVAL HELPERS. They MAY broadly expand how players might phrase, search for, misunderstand, or encounter the verified topic. They do not become policy facts.
- For server_rule and discord_rule content, retrieval coverage should be intentionally broad:
  * aliases: normally 18-35 useful entries, mixing short keywords, common terminology, abbreviations, action phrases, and natural player wording.
  * related_topics: normally 5-12 genuinely related concepts players may search alongside or confuse with this rule.
  * example_questions: normally 12-24 varied, realistic player questions or statements.
- For guides, FAQ, SOP, reference, and other knowledge, normally provide 10-25 aliases, 4-10 related topics, and 8-18 example questions when the source supports a reasonably broad topic.
- Do not pad lists with near-duplicates. Prefer useful wording diversity over superficial rephrasing.
- Keep retrieval helper entries concise: aliases should usually be short phrases, related topics should be topic names, and example questions should usually be one sentence.
- Include both short retrieval terms (for example "discord dm", "avoid rp") and longer natural phrases (for example "can i message them on discord instead").
- Example questions should cover multiple user intents such as permission ("can I..."), alternatives ("can I do X instead"), edge cases ("what if..."), obligations ("do I have to..."), and staff/help scenarios when relevant.
- It is acceptable for an example question to surface an edge case that the verified body does not fully answer, as long as the question is clearly related to the topic. The bot can then answer the verified portion and flag the missing detail as a knowledge gap.
- related_topics may include adjacent concepts for retrieval, but must not claim those concepts are violations of this rule unless the supplied text says so.
- If a genuinely material ambiguity remains after safe clarification, preserve that ambiguity rather than inventing an answer. Do not label ordinary lack of exhaustive examples as ambiguity.
- Prefer a concise descriptive title. If the staff supplied an obvious rule/article title, preserve it unless it is unusable.
- Select exactly one content_type and one category from the allowed keys. Select one or more audiences from the allowed keys.
- authoring_note should be a short staff-facing note calling out ambiguity or review points; use an empty string if none.

ALLOWED CONTENT TYPES:
${input.options.contentTypes.map(row => `${row.key}: ${row.label}${row.description ? ` — ${row.description}` : ''}`).join('\n')}

ALLOWED CATEGORIES:
${input.options.categories.map(row => `${row.key}: ${row.label}${row.description ? ` — ${row.description}` : ''}`).join('\n')}

ALLOWED AUDIENCES:
${input.options.audiences.map(row => `${row.key}: ${row.label}${row.description ? ` — ${row.description}` : ''}`).join('\n')}`,
    input: [
      input.contentTypeHint ? `CONTENT TYPE HINT: ${input.contentTypeHint}` : '',
      input.categoryHint ? `CATEGORY HINT: ${input.categoryHint}` : '',
      validAudienceHints.length ? `AUDIENCE HINTS: ${validAudienceHints.join(', ')}` : '',
      `STAFF-SUPPLIED VERIFIED INFORMATION:\n${sourceText.slice(0, 18000)}`
    ].filter(Boolean).join('\n\n'),
    max_output_tokens: 6000
  });

  const jsonText = response.output_text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const incompleteReason = (response as any).incomplete_details?.reason;
  if (!jsonText) {
    throw new Error('AI authoring returned no structured draft. Please try again.');
  }
  if (incompleteReason === 'max_output_tokens') {
    throw new Error('AI authoring response was cut off before the draft finished. Please try again.');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('AI authoring returned incomplete or invalid structured data. Please try again.');
  }

  const audiences = cleanList(parsed.audiences, 20, 64).filter(key => audienceKeys.includes(key));
  return {
    title: String(parsed.title || 'Untitled knowledge draft').replace(/\s+/g, ' ').trim().slice(0, 200),
    body: String(parsed.body || sourceText).trim().slice(0, 24000),
    content_type: chooseAllowed(parsed.content_type, contentTypeKeys, fallbackContentType),
    category: chooseAllowed(parsed.category, categoryKeys, fallbackCategory),
    audiences: audiences.length ? audiences : fallbackAudiences,
    aliases: cleanList(parsed.aliases, 100, 160),
    related_topics: cleanList(parsed.related_topics, 100, 160),
    example_questions: cleanList(parsed.example_questions, 150, 400),
    authoring_note: String(parsed.authoring_note || '').trim().slice(0, 2000)
  };
}

export async function improveKnowledgeRetrieval(input: {
  article: {
    title: string;
    body: string;
    content_type: string;
    category: string;
    audiences: string[];
    aliases?: string[];
    related_topics?: string[];
    example_questions?: string[];
  };
  options: KnowledgeAuthoringOptions;
}) {
  const suggestion = await buildKnowledgeDraft({
    sourceText: input.article.body,
    contentTypeHint: input.article.content_type,
    categoryHint: input.article.category,
    audienceHints: input.article.audiences,
    options: input.options
  });

  // Preserve verified content/permissions exactly and never make Improve with AI destructive.
  // Existing retrieval helpers are merged with new suggestions so a later AI pass cannot
  // accidentally shrink a carefully curated keyword/question set.
  return {
    ...suggestion,
    title: input.article.title,
    body: input.article.body,
    audiences: input.article.audiences,
    content_type: input.article.content_type,
    category: input.article.category,
    aliases: unique([...(input.article.aliases || []), ...suggestion.aliases], 100),
    related_topics: unique([...(input.article.related_topics || []), ...suggestion.related_topics], 100),
    example_questions: unique([...(input.article.example_questions || []), ...suggestion.example_questions], 150)
  };
}
