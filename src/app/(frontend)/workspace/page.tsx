import { Workspace } from '@/components/Workspace';
import '../workspace.css';
export const metadata = { title: '内容工作台', robots: { index: false, follow: false } };
export default function Page() { return <div className="workspace"><Workspace /></div>; }
