'use client'

import {useState, type FormEvent} from 'react'
import {HelpCircle, Loader2, CheckCircle2} from 'lucide-react'
import {Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog'
import {DEFAULT_TERM, termInfo} from '@/lib/catalog/terms'

export function CourseHelp(){
 const [open,setOpen]=useState(false)
 const [code,setCode]=useState('')
 const [outlineUrl,setOutlineUrl]=useState('')
 const [notes,setNotes]=useState('')
 const [busy,setBusy]=useState(false)
 const [sent,setSent]=useState(false)
 const [error,setError]=useState('')
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError('')
  try{
   const response=await fetch('/api/course-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,outlineUrl,notes})})
   const result=await response.json()
   if(!response.ok)throw Error(result.error||'Unable to send your request. Please try again.')
   setSent(true)
  }catch(e){setError(e instanceof Error?e.message:'Unable to send your request. Please try again.')}
  finally{setBusy(false)}
 }
 const inputClass='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500'
 return <Dialog open={open} onOpenChange={value=>{setOpen(value);if(value&&sent){setSent(false);setCode('');setOutlineUrl('');setNotes('');setError('')}}}>
  <DialogTrigger asChild>
   <button type="button" aria-label="Help: request a missing course" title="Request a missing course" className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-800 shadow-lg transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2" style={{bottom:'max(1.25rem, env(safe-area-inset-bottom))'}}>
    <HelpCircle className="h-6 w-6" aria-hidden="true" />
   </button>
  </DialogTrigger>
  <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl bg-white p-6 text-gray-900 sm:max-w-md">
   <DialogHeader>
    <DialogTitle className="text-xl">Missing a course?</DialogTitle>
    <DialogDescription className="pt-1 text-gray-600">Let us know which {termInfo(DEFAULT_TERM).label} course you’d like added to GooseGrade.</DialogDescription>
   </DialogHeader>
   {sent?<div className="space-y-4 py-3" role="status">
    <CheckCircle2 className="h-8 w-8 text-green-700" aria-hidden="true" />
    <p className="font-medium">Thanks — your course request is in the queue.</p>
    <p className="text-sm text-gray-600">We’ll review the outline and its assessment weights before adding it.</p>
    <button className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white hover:bg-gray-800" onClick={()=>setOpen(false)}>Done</button>
   </div>:<form onSubmit={submit} className="space-y-4">
    <div className="space-y-1.5"><label htmlFor="request-course" className="text-sm font-medium">Course code</label><input id="request-course" className={inputClass} value={code} onChange={e=>setCode(e.target.value)} placeholder="e.g. CS 135" required maxLength={30} autoComplete="off" disabled={busy}/></div>
    <div className="space-y-1.5"><label htmlFor="request-outline" className="text-sm font-medium">Outline link <span className="font-normal text-gray-500">(optional)</span></label><input id="request-outline" className={inputClass} type="url" value={outlineUrl} onChange={e=>setOutlineUrl(e.target.value)} placeholder="https://outline.uwaterloo.ca/…" maxLength={1000} disabled={busy}/></div>
    <div className="space-y-1.5"><label htmlFor="request-notes" className="text-sm font-medium">Anything else? <span className="font-normal text-gray-500">(optional)</span></label><textarea id="request-notes" className={inputClass} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Section number or anything that will help us find it" rows={3} maxLength={1000} disabled={busy}/></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white hover:bg-gray-800 disabled:opacity-60">{busy&&<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true"/>}{busy?'Sending…':'Request course'}</button>
   </form>}
  </DialogContent>
 </Dialog>
}
