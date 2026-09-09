import { db } from '../db.js';

export type LearningModule='tickets'|'issues'|'suggestions'|'knowledge'|'moderation'|'txadmin';
export type LearningDecision='routing'|'priority'|'category'|'moderation'|'txadmin_match'|'general';
type Executor={query:(text:string,values?:unknown[])=>Promise<any>};

const priorityScores:Record<string,number>={urgent:100,high:88,normal:68,low:42};
type RoutingRow={module_key:string;input_text:string;normalized_text:string;predicted_value:string;corrected_value:string;staff_note:string};
let routingCache:{expires:number;rows:RoutingRow[]}={expires:0,rows:[]};

export function normalizeLearningText(value:string){
  return String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9/_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,5000);
}

export async function upsertLearningExample(input:{
  module:LearningModule;decisionType:LearningDecision;resourceType:string;resourceId:string;inputText:string;
  predictedValue?:string;correctedValue?:string;staffNote?:string;metadata?:Record<string,unknown>;
  actorUserId?:string|null;trusted?:boolean;
},executor:Executor=db){
  const inputText=String(input.inputText||'').trim().slice(0,12000);
  if(!inputText)return null;
  const result=await executor.query(`
    INSERT INTO automation_learning_examples
      (module_key,decision_type,source_resource_type,source_resource_id,input_text,normalized_text,
       predicted_value,corrected_value,staff_note,metadata,trusted,reviewed_by_user_id,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,NOW())
    ON CONFLICT(module_key,decision_type,source_resource_type,source_resource_id) DO UPDATE SET
      input_text=EXCLUDED.input_text,normalized_text=EXCLUDED.normalized_text,predicted_value=EXCLUDED.predicted_value,
      corrected_value=EXCLUDED.corrected_value,staff_note=EXCLUDED.staff_note,metadata=EXCLUDED.metadata,
      trusted=EXCLUDED.trusted,reviewed_by_user_id=EXCLUDED.reviewed_by_user_id,updated_at=NOW()
    RETURNING id`,[
      input.module,input.decisionType,String(input.resourceType).slice(0,80),String(input.resourceId).slice(0,160),inputText,
      normalizeLearningText(inputText),String(input.predictedValue||'').slice(0,120),String(input.correctedValue||'').slice(0,120),
      String(input.staffNote||'').trim().slice(0,2000),JSON.stringify(input.metadata||{}),input.trusted!==false,input.actorUserId||null
  ]);
  if(input.decisionType==='routing')routingCache.expires=0;
  return result.rows[0]||null;
}

function trigrams(value:string){
  const text=`  ${normalizeLearningText(value)} `;const result=new Set<string>();
  for(let index=0;index<text.length-2;index++)result.add(text.slice(index,index+3));
  return result;
}

function textSimilarity(left:string,right:string){
  const leftTokens=tokens(left);const rightTokens=tokens(right);const wordScore=overlap(leftTokens,rightTokens);
  const a=trigrams(left);const b=trigrams(right);let shared=0;for(const part of a)if(b.has(part))shared++;
  const trigramScore=a.size&&b.size?(2*shared)/(a.size+b.size):0;
  return Math.min(1,wordScore*.68+trigramScore*.32);
}

export async function routingCalibrationPrompt(content:string){
  const normalized=normalizeLearningText(content);
  if(normalized.length<4)return '(none available)';
  if(routingCache.expires<Date.now()){
    const result=await db.query(`SELECT module_key,input_text,normalized_text,predicted_value,corrected_value,staff_note
      FROM automation_learning_examples WHERE trusted=TRUE AND decision_type='routing' ORDER BY updated_at DESC LIMIT 150`);
    routingCache={expires:Date.now()+30_000,rows:result.rows};
  }
  const intentFor=(value:string)=>({issues:'issue',suggestions:'suggestion',knowledge:'question',tickets:'staff_request'} as Record<string,string>)[value]||null;
  const rows=routingCache.rows.map(row=>({row,similarity:textSimilarity(normalized,row.normalized_text),
      predictedIntent:intentFor(row.predicted_value||row.module_key),correctedIntent:intentFor(row.corrected_value||row.module_key)}))
    .filter(item=>item.similarity>=.08&&item.predictedIntent&&item.correctedIntent)
    .sort((a,b)=>b.similarity-a.similarity).slice(0,6);
  if(!rows.length)return '(none available)';
  return rows.map(({row,similarity,predictedIntent,correctedIntent},index)=>[
    `STAFF EXAMPLE ${index+1} · ${similarity.toFixed(2)} wording similarity`,
    `Message: ${String(row.input_text).replace(/\s+/g,' ').slice(0,500)}`,
    `Original intent: ${predictedIntent}`,
    `Staff-confirmed intent: ${correctedIntent}`,
    row.staff_note?`Staff note: ${String(row.staff_note).replace(/\s+/g,' ').slice(0,400)}`:''
  ].filter(Boolean).join('\n')).join('\n\n');
}

export async function categoryCalibrationPrompt(module:'issues'|'suggestions',content:string,allowedCategories:string[]=[]){
  const normalized=normalizeLearningText(content);if(normalized.length<4)return '(none available)';
  const result=await db.query(`SELECT input_text,predicted_value,corrected_value,staff_note,
    similarity(normalized_text,$2)::float AS similarity FROM automation_learning_examples
    WHERE trusted=TRUE AND decision_type='category' AND module_key=$1 AND similarity(normalized_text,$2)>=.08
    ORDER BY similarity(normalized_text,$2) DESC,updated_at DESC LIMIT 6`,[module,normalized]);
  const allowed=new Set(allowedCategories);
  const rows=result.rows.filter(row=>!allowed.size||allowed.has(String(row.corrected_value)));
  if(!rows.length)return '(none available)';
  return rows.map((row,index)=>[
    `CATEGORY EXAMPLE ${index+1} · ${Number(row.similarity).toFixed(2)} wording similarity`,
    `Item: ${String(row.input_text).replace(/\s+/g,' ').slice(0,500)}`,
    `AI/previous category: ${String(row.predicted_value||'unknown')}`,
    `Staff-confirmed category: ${String(row.corrected_value)}`,
    row.staff_note?`Staff note: ${String(row.staff_note).replace(/\s+/g,' ').slice(0,400)}`:''
  ].filter(Boolean).join('\n')).join('\n\n');
}

function tokens(value:string){return new Set(normalizeLearningText(value).split(' ').filter(token=>token.length>=4));}
function overlap(a:Set<string>,b:Set<string>){
  if(!a.size||!b.size)return 0;let hits=0;for(const token of a)if(b.has(token))hits++;
  return hits/Math.max(2,Math.min(a.size,b.size));
}

export async function applyPriorityCalibration<T extends {module:LearningModule;title:string;detail:string;priority:string;priority_score:number;reason:string}>(items:T[]):Promise<T[]>{
  if(!items.length)return items;
  const result=await db.query(`SELECT module_key,input_text,corrected_value,staff_note FROM automation_learning_examples
    WHERE trusted=TRUE AND decision_type='priority' ORDER BY updated_at DESC LIMIT 150`);
  if(!result.rowCount)return items;
  const examples=result.rows.map(row=>({...row,token_set:tokens(row.input_text)}));
  return items.map(item=>{
    if(item.priority==='urgent')return item; // Never lower a hard urgent safety/server signal through analogy.
    const itemTokens=tokens(`${item.title} ${item.detail}`);
    const best=examples.filter(row=>row.module_key===item.module&&priorityScores[String(row.corrected_value)]!==undefined)
      .map(row=>({row,score:overlap(itemTokens,row.token_set)})).sort((a,b)=>b.score-a.score)[0];
    if(!best||best.score<0.58)return item;
    const priority=String(best.row.corrected_value) as T['priority'];
    return {...item,priority,priority_score:priorityScores[priority],reason:`${item.reason} Staff-calibrated from a similar reviewed item.${best.row.staff_note?` ${String(best.row.staff_note).slice(0,160)}`:''}`};
  });
}

export async function getLearningStats(){
  const [examples,feedback]=await Promise.all([
    db.query(`SELECT module_key,count(*)::int AS trusted FROM automation_learning_examples WHERE trusted=TRUE GROUP BY module_key`),
    db.query(`SELECT module_key,
      count(*) FILTER (WHERE outcome='helpful')::int AS helpful_30d,
      count(*) FILTER (WHERE outcome='incorrect')::int AS corrections_30d
      FROM automation_feedback_events WHERE created_at>NOW()-INTERVAL '30 days' GROUP BY module_key`)
  ]);
  const modules:Record<string,{trusted:number;helpful_30d:number;corrections_30d:number}>={};
  for(const row of examples.rows)modules[String(row.module_key)]={trusted:Number(row.trusted||0),helpful_30d:0,corrections_30d:0};
  for(const row of feedback.rows){
    const key=String(row.module_key);modules[key]=modules[key]||{trusted:0,helpful_30d:0,corrections_30d:0};
    modules[key].helpful_30d=Number(row.helpful_30d||0);modules[key].corrections_30d=Number(row.corrections_30d||0);
  }
  const totals=Object.values(modules).reduce((sum,row)=>({trusted:sum.trusted+row.trusted,helpful_30d:sum.helpful_30d+row.helpful_30d,corrections_30d:sum.corrections_30d+row.corrections_30d}),{trusted:0,helpful_30d:0,corrections_30d:0});
  return {active:true,totals,modules};
}
