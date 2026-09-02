import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can,getDashboardAccess } from '../../../lib/permissions';
import SuggestionCreateForm from '../../../components/SuggestionCreateForm';

export default async function CreateSuggestionPage(){
  const access=await getDashboardAccess();
  if(!can(access,'suggestions.manage')) redirect('/suggestions');
  return <>
    <header className="pageHeader"><div><p className="eyebrow">SUGGESTIONS</p><h1>Create Suggestion</h1><p>Add a staff-entered idea to the same queue used for Discord-detected community suggestions.</p></div><Link className="button" href="/suggestions">Back to Suggestions</Link></header>
    <section className="panel"><div className="panelTitle"><div><h2>New suggestion</h2><p>Use this for ideas staff receives outside the monitored Discord flow.</p></div></div><SuggestionCreateForm/></section>
  </>;
}
