import KnowledgeLibraryView from '../../../components/KnowledgeLibraryView';
export default function Page({searchParams}:{searchParams:Promise<{q?:string;category?:string;status?:string;sort?:string}>}) {
  return <KnowledgeLibraryView scope="discord_rule" eyebrow="DISCORD RULES" title="Discord Rules" subtitle="Community conduct rules and moderation-eligible Discord policy." searchParams={searchParams}/>;
}
