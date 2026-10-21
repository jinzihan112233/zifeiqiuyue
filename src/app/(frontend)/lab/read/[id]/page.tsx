import '../../../workspace.css';
import { Reader } from '@/components/Reader';
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <div className="workspace"><Reader contentId={(await params).id} /></div>; }
