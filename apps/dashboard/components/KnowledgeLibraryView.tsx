import Link from 'next/link';
import { api } from '../lib/api';
import { can, getDashboardAccess } from '../lib/permissions';

type Article = {
  id: string;
  title: string;
  body: string;
  content_type: string;
  category: string;
  audiences: string[];
  status: string;
  aliases: string[];
  related_topics: string[];
  example_questions: string[];
  updated_at: string;
  created_at: string;
};

type ContentType = { key:string; label:string; enabled:boolean };
type Category = { key:string; label:string; enabled:boolean };
type Settings = { content_types:ContentType[]; categories:Category[]; audiences:unknown[]; discord_roles:unknown[] };

type Params = { q?:string; category?:string; status?:string; sort?:string };

type Scope = 'all' | 'server_rule' | 'discord_rule' | 'general';

function labelFor(key:string, values:{key:string;label:string}[]) {
  return values.find(row => row.key === key)?.label || key.replaceAll('_',' ');
}

function searchable(row:Article) {
  return [row.title,row.body,row.content_type,row.category,...(row.aliases||[]),...(row.related_topics||[]),...(row.example_questions||[])].join(' ').toLowerCase();
}

function hrefWith(scope:Scope, params:Record<string,string>) {
  const base = scope === 'server_rule' ? '/knowledge/server-rules' : scope === 'discord_rule' ? '/knowledge/discord-rules' : scope === 'all' ? '/knowledge/all' : '/knowledge';
  const qs = new URLSearchParams(Object.entries(params).filter(([,value]) => value && value !== 'all'));
  return qs.size ? `${base}?${qs}` : base;
}

export default async function KnowledgeLibraryView({
  scope,
  title,
  subtitle,
  eyebrow = 'KNOWLEDGE',
  searchParams
}: {
  scope:Scope;
  title:string;
  subtitle:string;
  eyebrow?:string;
  searchParams:Promise<Params>;
}) {
  const params = await searchParams;
  let articles:Article[] = [];
  let settings:Settings = { content_types:[], categories:[], audiences:[], discord_roles:[] };
  let loadError = '';
  let access=null;
  try {
    [articles,settings,access] = await Promise.all([
      api<Article[]>('/api/knowledge'),
      api<Settings>('/api/knowledge/settings'),
      getDashboardAccess()
    ]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unable to load knowledge.';
  }

  const query = String(params.q || '').trim().toLowerCase();
  const category = String(params.category || 'all');
  const status = String(params.status || 'all');
  const sort = String(params.sort || 'updated_desc');

  const scoped = articles.filter(row => {
    if (scope === 'server_rule' && row.content_type !== 'server_rule') return false;
    if (scope === 'discord_rule' && row.content_type !== 'discord_rule') return false;
    if (scope === 'general' && ['server_rule','discord_rule'].includes(row.content_type)) return false;
    return true;
  });

  const rows = scoped.filter(row => {
    if (category !== 'all' && row.category !== category) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (query && !searchable(row).includes(query)) return false;
    return true;
  });

  rows.sort((a,b) => {
    if (sort === 'title_asc') return a.title.localeCompare(b.title);
    if (sort === 'category_asc') return labelFor(a.category,settings.categories).localeCompare(labelFor(b.category,settings.categories)) || a.title.localeCompare(b.title);
    if (sort === 'created_desc') return +new Date(b.created_at) - +new Date(a.created_at);
    return +new Date(b.updated_at) - +new Date(a.updated_at);
  });

  const published = scoped.filter(row => row.status === 'published').length;
  const drafts = scoped.filter(row => row.status === 'draft').length;
  const createScope = scope === 'server_rule' || scope === 'discord_rule' || scope === 'all' ? scope : 'general';

  return <>
    <header className="pageHeader compactPageHeader">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {can(access,'knowledge.create')?<div className="headerActions">
        <details className="createDropdown">
          <summary className="button primary">+ Create</summary>
          <div className="createDropdownMenu">
            {can(access,'knowledge.ai')?<Link href={`/knowledge/create?mode=ai&scope=${createScope}`}><strong>✨ Create with AI</strong><span>Paste verified information and let Saucin AI build the draft.</span></Link>:null}
            <Link href={`/knowledge/create?mode=manual&scope=${createScope}`}><strong>Create manually</strong><span>Fill every field yourself.</span></Link>
          </div>
        </details>
      </div>:null}
    </header>

    {loadError ? <div className="alert error">Could not load knowledge: {loadError}</div> : null}

    <div className="librarySummaryBar">
      <span><strong>{published}</strong> published</span>
      <span><strong>{drafts}</strong> drafts</span>
      <span><strong>{scoped.length}</strong> total</span>
      {scope !== 'all' ? <Link href="/knowledge/all">View all knowledge</Link> : null}
    </div>

    <section className="libraryPanel">
      <form className="libraryToolbar" method="get">
        <label className="librarySearch"><span>⌕</span><input name="q" defaultValue={params.q || ''} placeholder={`Search ${title.toLowerCase()}...`} aria-label={`Search ${title}`} /></label>
        <select className="select input" name="category" defaultValue={category} aria-label="Filter by category">
          <option value="all">All categories</option>
          {settings.categories.filter(row => row.enabled).map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
        </select>
        <select className="select input" name="status" defaultValue={status} aria-label="Filter by status">
          <option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>
        </select>
        <select className="select input" name="sort" defaultValue={sort} aria-label="Sort knowledge">
          <option value="updated_desc">Recently updated</option><option value="title_asc">Title A-Z</option><option value="category_asc">Category A-Z</option><option value="created_desc">Newest created</option>
        </select>
        <button className="button" type="submit">Apply</button>
        {(query || category !== 'all' || status !== 'all' || sort !== 'updated_desc') ? <Link className="button subtle" href={hrefWith(scope,{})}>Reset</Link> : null}
      </form>

      <div className="libraryTableWrap">
        <table className="libraryTable">
          <thead><tr><th>Title</th>{scope === 'all' ? <th>Type</th> : null}<th>Category</th><th>Audience</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>
            {rows.map(row => <tr key={row.id}>
              <td><Link className="articleTitleLink" href={`/knowledge/${row.id}?from=${encodeURIComponent(scope)}`}><strong>{row.title}</strong><small>{row.body.slice(0,120)}{row.body.length>120?'…':''}</small></Link></td>
              {scope === 'all' ? <td><span className="typePill">{labelFor(row.content_type,settings.content_types)}</span></td> : null}
              <td>{labelFor(row.category,settings.categories)}</td>
              <td><div className="miniPills">{(row.audiences||[]).slice(0,2).map(a => <span key={a}>{a}</span>)}{(row.audiences||[]).length>2?<span>+{row.audiences.length-2}</span>:null}</div></td>
              <td><span className={`statusBadge status-${row.status}`}>{row.status}</span></td>
              <td><time dateTime={row.updated_at}>{new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(row.updated_at))}</time></td>
            </tr>)}
            {!rows.length ? <tr><td colSpan={scope === 'all' ? 6 : 5}><div className="emptyLibrary"><strong>No matching knowledge found.</strong><span>Try changing the filters or create a new article.</span></div></td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}
