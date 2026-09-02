import KnowledgeLibraryView from '../../../components/KnowledgeLibraryView';
export default function Page({searchParams}:{searchParams:Promise<{q?:string;category?:string;status?:string;sort?:string}>}) {
  return <KnowledgeLibraryView scope="server_rule" eyebrow="SERVER RULES" title="Server Rules" subtitle="FiveM rules, roleplay expectations, gameplay conduct, and server policy." searchParams={searchParams}/>;
}
