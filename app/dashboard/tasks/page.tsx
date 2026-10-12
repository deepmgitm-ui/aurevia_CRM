import { getTaskPage } from "@/app/actions/crm-workflows";
import { TaskCenter } from "./task-center";
export default async function TasksPage(){
 const result=await getTaskPage();
 return <div className="mx-auto w-full max-w-7xl space-y-6"><div><h1 className="text-2xl font-semibold text-slate-950">Follow-ups & Calling</h1><p className="mt-2 text-sm text-slate-500">Work through overdue callbacks, log a call and move to the next patient.</p></div>{result.success?<TaskCenter leads={result.data.leads} initialPage={result.data}/>:<p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{result.error}</p>}</div>;
}
