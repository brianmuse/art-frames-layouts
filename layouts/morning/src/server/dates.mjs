export function localDate(date, timezone) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const value=key=>parts.find(part=>part.type===key).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function displayDays(today) {
  const day=new Date(today+'T12:00:00Z'),weekday=day.getUTCDay();
  if(weekday>0 && weekday<6) return [today];
  if(weekday===0) day.setUTCDate(day.getUTCDate()-1);
  return [day.toISOString().slice(0,10),new Date(day.valueOf()+86400000).toISOString().slice(0,10)];
}
export function syncDay(now,timezone,at='03:00') {
  const day=localDate(now,timezone),clock=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  if(clock>=at) return day;
  const previous=new Date(day+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
  return previous.toISOString().slice(0,10);
}
