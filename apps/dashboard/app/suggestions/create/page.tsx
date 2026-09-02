import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can,getDashboardAccess } from '../../../lib/permissions';
import SuggestionCreateForm from '../../../components/SuggestionCreateForm';

type Params=Promise<{mode?:string}>;

export default async function CreateSuggestionPage({searchParams}:{searchParams:Params}){
  const access=await getDashboardAccess();
  if(!can(access,'suggestions.manage')) redirect('/suggestions');
  const params=await searchParams;
  let mode: 'ai'|'manual'=params.mode==='manual'?'manual':'ai';
  if(mode==='ai'&&!can(access,'suggestions.ai')) mode='manual';

  return <>
    <header className="pageHeader"><div><p className="eyebrow">SUGGESTIONS</p><h1>{mode==='ai'?'Create Suggestion with AI':'Create Suggestion Manually'}</h1><p>{mode==='ai'?'Start with a rough idea and let Saucin AI turn it into an editable, discussion-ready draft.':'Add a staff-entered idea to the same queue used for Discord-detected community suggestions.'}</p></div><Link className="button" href="/suggestions">Back to Suggestions</Link></header>
    <div className="creationModeSwitch">
      {can(access,'suggestions.ai')?<Link className={mode==='ai'?'active':''} href="/suggestions/create?mode=ai">✨ Create with AI</Link>:null}
      <Link className={mode==='manual'?'active':''} href="/suggestions/create?mode=manual">Create manually</Link>
    </div>
    <section className="panel"><div className="panelTitle"><div><h2>{mode==='ai'?'Develop a community idea':'New suggestion'}</h2><p>{mode==='ai'?'AI organizes the idea while the original source remains preserved.':'Use this for ideas staff receives outside the monitored Discord flow.'}</p></div></div><SuggestionCreateForm mode={mode}/></section>
  </>;
}
