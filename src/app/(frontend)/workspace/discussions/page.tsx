import { DiscussionManagement } from '@/components/DiscussionManagement';
import '../../workspace.css';
export const metadata = { title: '讨论与举报管理', robots: { index: false, follow: false } };
export default function Page() { return <div className="workspace"><DiscussionManagement /></div>; }
