import KnowledgeLibraryView from '../../components/KnowledgeLibraryView';
export default function Page({searchParams}:{searchParams:Promise<{q?:string;category?:string;status?:string;sort?:string}>}) {
  return <KnowledgeLibraryView scope="general" title="Guides & Knowledge" subtitle="Guides, FAQs, SOPs, references, and other verified information." searchParams={searchParams}/>;
}
