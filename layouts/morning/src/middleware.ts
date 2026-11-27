import { defineMiddleware } from 'astro:middleware';
import sample from './fixtures/sample.json';
import busyAgenda from './fixtures/busy-agenda.json';
import veryBusyAgenda from './fixtures/very-busy-agenda.json';
import manyCalendarsAgenda from './fixtures/many-calendars-agenda.json';
import sampleTodos from './fixtures/sample-todos.json';
import { livePreview } from './lib/live-preview';
import { dashboard, settings } from '#server/dashboard.mjs';
export const onRequest = defineMiddleware(async (context, next) => {
  const mode = import.meta.env.DEV ? context.url.searchParams.get('preview') : 'current';
  if (import.meta.env.DEV && context.url.searchParams.get('data')==='sample') {
    const snapshot=structuredClone(sample);
    const agenda=({busy:busyAgenda,'very-busy':veryBusyAgenda,'many-calendars':manyCalendarsAgenda} as Record<string,any>)[context.url.searchParams.get('agenda') || ''];
    if (agenda) {
      snapshot.planner.plan.today=structuredClone(agenda);
      snapshot.planner.plan.calendar_days[0].events=snapshot.planner.plan.today;
    }
    if (context.url.searchParams.get('tasks')==='sample') (snapshot.planner.plan as any).todos=structuredClone(sampleTodos);
    if (mode==='weekend') {
      snapshot.now='2026-10-31T08:00:00-04:00';
      snapshot.planner.plan.calendar_days=[{date:'2026-10-31',label:'Saturday',events:snapshot.planner.plan.today},{date:'2026-11-01',label:'Sunday',events:snapshot.planner.plan.tomorrow}];
    }
    // Dev-only clock override (HH:MM on the snapshot's day) to show past, now and next states.
    const at=context.url.searchParams.get('at') || '';
    if (/^\d{2}:\d{2}$/.test(at)) snapshot.now=snapshot.now.slice(0,11)+at+':00'+snapshot.now.slice(19);
    if (mode==='art' || mode==='empty') snapshot.planner={active:false,plan:null};
    if (mode==='empty') delete snapshot.art;
    context.locals.snapshot=snapshot;
  } else {
    let snapshot=context.locals.snapshot;
    if (!snapshot && import.meta.env.DEV && context.url.searchParams.get('art')==='live') {
      const result=await livePreview(context.request.headers.get('authorization'),null);
      if (result instanceof Response) return result;
      snapshot=result;
    }
    if (!snapshot) snapshot={...structuredClone(sample),now:new Date().toISOString()};
    // Every render shows the planner. render_purpose and ignore_display_hours from the host do not change it.
    context.locals.snapshot=await dashboard(snapshot,await settings(),{mode:mode || 'current',deferWhenSyncing:!import.meta.env.DEV});
  }
  // Dev-only comparison of agenda layouts; production keeps calendars grouped.
  if (import.meta.env.DEV && context.url.searchParams.get('timeline')==='chronological') context.locals.timeline='chronological';
  if(!import.meta.env.DEV && context.locals.snapshot?.planner?.plan?.calendar_syncing) return new Response(null,{status:202,headers:{'Retry-After':'2','Cache-Control':'no-store'}});
  const response=await next();
  response.headers.set('Cache-Control','no-store');
  return response;
});
