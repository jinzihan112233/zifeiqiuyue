import { Workspace } from '@/components/Workspace';
import '../workspace.css';
export const metadata = { title: '发布文章', robots: { index: false, follow: false } };
export default function Page() { return <div className="workspace"><Workspace /></div>; }
