import KnowledgeLibraryView from '../../../components/KnowledgeLibraryView';
export default function Page({searchParams}:{searchParams:Promise<{q?:string;category?:string;status?:string;sort?:string}>}) {
  return <KnowledgeLibraryView scope="all" title="All Knowledge" subtitle="Search every rule, guide, FAQ, SOP, and reference article in one place." searchParams={searchParams}/>;
}
