export type ParsedTaskPriority = 'Low' | 'Normal' | 'High';

export type ParsedInfoTask = {
  title: string;
  person: string;
  scheduledStart: string | null;
  recurrence: 'WEEKLY' | null;
  recurrenceDays?: number[];
  estimatedMinutes: number;
  priority: ParsedTaskPriority;
};

const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const actionStart = /\b(?:get|find|email|call|buy|pick|schedule|submit|finish|send|review|meet|study|do|make|write|complete|check)\b/i;
const numberWords: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12 };
const typoCorrections: Record<string, string> = {
  tommorow: 'tomorrow', tomorow: 'tomorrow', tusday: 'tuesday',
  thurday: 'thursday', thrusday: 'thursday', wednsday: 'wednesday', wendsday: 'wednesday',
  calander: 'calendar', scheudle: 'schedule', remeber: 'remember', recieve: 'receive',
  seperate: 'separate', grocceries: 'groceries', assignemnt: 'assignment', emial: 'email',
  theres: "there's", smtnhg: 'something', smthng: 'something', somthing: 'something',
  hystory: 'history', hystorey: 'history', historey: 'history', freinds: 'friends',
};

function correctText(value: string) {
  let corrected = value.replace(/\b[\p{L}\p{N}']+\b/gu, word => typoCorrections[word.toLowerCase()] ?? word);
  corrected = corrected
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bive\b/gi, "I've")
    .replace(/\bdont\b/gi, "don't")
    .replace(/\bcant\b/gi, "can't")
    .replace(/\bwont\b/gi, "won't")
    .replace(/\bdoesnt\b/gi, "doesn't")
    .replace(/\bchem\b/gi, 'chemistry')
    .replace(/\bbio\b/gi, 'biology')
    .replace(/\bhw\b/gi, 'homework')
    .replace(/\bappt\b/gi, 'appointment')
    .replace(/\bchap(?:ter)?\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, (_, number: string) => `chapter ${numberWords[number.toLowerCase()]}`)
    .replace(/\bchap\.?\s+(\d+)\b/gi, 'chapter $1');
  return corrected;
}

function nextWeekday(day: number, hour: number, minute: number, now: Date) {
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  let distance = (day - date.getDay() + 7) % 7;
  if (distance === 0 && date <= now) distance = 7;
  date.setDate(date.getDate() + distance);
  return date.toISOString();
}

function parseHour(rawHour: string, meridiem?: string) {
  let hour = Number(rawHour);
  const marker = meridiem?.toLowerCase();
  if (marker === 'pm' && hour < 12) hour += 12;
  if (marker === 'am' && hour === 12) hour = 0;
  if (!marker && hour >= 1 && hour <= 7) hour += 12;
  return hour;
}

function conciseTitle(value: string) {
  let clean = correctText(value)
    .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
    .replace(/^(?:and\s+)?(?:i\s+)?(?:also\s+)?(?:have\s+to\s+|need\s+to\s+|should\s+|want\s+to\s+|must\s+|remember\s+to\s+)?/i, '')
    .replace(/^(?:please\s+)?(?:help me\s+)?(?:find a time to\s+)?/i, '')
    .replace(/^(?:important|urgent|asap|high priority)\s+/i, '')
    .replace(/\s+(?:urgent|asap|high priority)$/i, '')
    .replace(/^study for\s+/i, 'Study ')
    .replace(/^not sure when (?:the )?car (?:goes|needs to go) to (?:the )?shop$/i, 'Schedule car service')
    .replace(/^my team plays\b/i, 'Team game')
    .replace(/\bdoc(?:tor)?\b/gi, 'doctor appointment')
    .replace(/\s+/g, ' ')
    .trim();
  clean = clean
    .replace(/\bchemistry\b/gi, 'Chemistry')
    .replace(/\bbiology\b/gi, 'Biology')
    .replace(/\bchapter\b/gi, 'Chapter')
    .replace(/\bfort smith\b/gi, 'Fort Smith');
  if (clean.length > 90) clean = `${clean.slice(0, 87).trimEnd()}…`;
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : '';
}

function relativeSchedule(value: string, now: Date) {
  const lower=correctText(value).toLowerCase();
  let hour=9,minute=0;
  let hasTime=false;
  const wordTime=lower.match(/\b(?:at|around)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
  const fourDigit=lower.match(/\b([1-9])([0-5]\d)0\b/);
  const clockTime=lower.match(/\b(?:at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if(wordTime){hour=parseHour(String(numberWords[wordTime[1]]));hasTime=true;}
  else if(fourDigit){hour=parseHour(fourDigit[1]);minute=Number(fourDigit[2]);hasTime=true;}
  else if(clockTime){hour=parseHour(clockTime[1],clockTime[3]);minute=Number(clockTime[2]??0);hasTime=true;}
  else if(/\bafternoon\b/.test(lower)){hour=14;hasTime=true;}
  else if(/\bevening|tonight\b/.test(lower)){hour=18;hasTime=true;}
  else if(/\bmorning\b/.test(lower)){hour=8;hasTime=true;}
  else if(/\bnoon\b/.test(lower)){hour=12;hasTime=true;}
  else if(/\bafter school\b/.test(lower)){hour=16;hasTime=true;}
  else if(/\bbedtime\b/.test(lower)){hour=21;hasTime=true;}

  const date=new Date(now);
  const recurrenceDays=repeatDaysFor(lower);
  if(recurrenceDays.length){date.setHours(hour,minute,0,0);for(let offset=0;offset<8;offset++){const candidate=new Date(date);candidate.setDate(candidate.getDate()+offset);if(recurrenceDays.includes(candidate.getDay())&&candidate>now)return candidate.toISOString()}return null;}
  if(/\bend of (?:the )?month\b/.test(lower))date.setMonth(date.getMonth()+1,0);
  else if(/\btomorrow\b/.test(lower))date.setDate(date.getDate()+1);
  else if(/\bnext week\b/.test(lower)){const distance=(8-date.getDay())%7||7;date.setDate(date.getDate()+distance);}
  else if(!/\btoday\b/.test(lower))return null;
  if(/\btoday\b/.test(lower)&&!hasTime){const rounded=new Date(now);rounded.setSeconds(0,0);if(rounded.getMinutes()<30)rounded.setMinutes(30);else{rounded.setHours(rounded.getHours()+1);rounded.setMinutes(0)}return rounded.toISOString();}
  date.setHours(hour,minute,0,0);
  return date.toISOString();
}

function stripSchedule(value:string){return conciseTitle(value
  .replace(/\b(?:at|around)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,4}(?::\d{2})?\s*(?:am|pm)?)\b/gi,'')
  .replace(/\b(?:today|tomorrow(?:\s+morning|\s+afternoon|\s+evening)?|next week|at the end of (?:the )?month|end of (?:the )?month|every morning|every evening|every day|daily|weekdays?)\b/gi,'')
  .replace(/^(?:i\s+)?have\s+/i,'')
  .replace(/\s+/g,' '));}

function priorityFor(value: string): ParsedTaskPriority {
  const lower = correctText(value).toLowerCase();
  if (/\b(?:urgent|asap|important|high priority|exam|test|quiz|submit|due|food|eat|meal|water|medicine|medication|doctor|safety|ride|transportation)\b/.test(lower)) return 'High';
  if (/\b(?:low priority|someday|whenever|when possible|no rush)\b/.test(lower)) return 'Low';
  return 'Normal';
}

function repeatDaysFor(value:string){const lower=correctText(value).toLowerCase();if(/\b(?:every day|daily|every morning|every evening)\b/.test(lower))return[0,1,2,3,4,5,6];if(/\bweekdays?\b/.test(lower))return[1,2,3,4,5];if(!/\bevery\b/.test(lower))return[];return weekdayNames.map((name,index)=>new RegExp(`\\b${name}\\b`).test(lower)?index:-1).filter(index=>index>=0)}

function durationFor(value:string){return /\b(?:all day|no school|day off)\b/i.test(correctText(value))?480:30}

function personalTasks(sentence: string, owner: string, now:Date): ParsedInfoTask[] {
  const clean = correctText(sentence)
    .replace(/^(?:and\s+)?(?:i\s+)?(?:also\s+)?(?:have\s+to\s+|need\s+to\s+|should\s+)?/i, '')
    .trim();
  return clean
    .split(/\s+and\s+(?=(?:get|find|email|call|buy|pick|schedule|submit|finish|send|review|meet|study|do|make|write|complete|check)\b)/i)
    .map(value=>({title:stripSchedule(value),scheduledStart:relativeSchedule(value,now),priority:priorityFor(value),recurrenceDays:repeatDaysFor(value),estimatedMinutes:durationFor(value)}))
    .filter(item=>item.title&&!/^(?:help me|remind me|not sure)$/i.test(item.title))
    .map(item => ({ ...item, person: owner, recurrence: item.recurrenceDays.length?'WEEKLY' as const:null,recurrenceDays:item.recurrenceDays.length?item.recurrenceDays:undefined }));
}

export function parseInfoDump(input: string, people: string[], personalOwner = 'Alex Advisor', now = new Date()): ParsedInfoTask[] {
  const correctedInput = correctText(input);
  const nameEntries = people.map(person => ({ person, first: person.split(' ')[0].toLowerCase() }));
  const sentences = correctedInput.split(/[.\n]+/).map(value => value.trim()).filter(Boolean);
  const parsed: ParsedInfoTask[] = [];

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const mentions = nameEntries
      .flatMap(entry => Array.from(lower.matchAll(new RegExp(`\\b${entry.first}\\b`, 'gi'))).map(match => ({ ...entry, index: match.index ?? 0 })))
      .sort((a, b) => a.index - b.index);

    if (!mentions.length) {
      parsed.push(...personalTasks(sentence, personalOwner, now));
      continue;
    }

    mentions.forEach((mention, mentionIndex) => {
      const end = mentions[mentionIndex + 1]?.index ?? sentence.length;
      const segment = sentence.slice(mention.index, end);
      const days = Array.from(segment.toLowerCase().matchAll(new RegExp(`\\b(${weekdayNames.join('|')})\\b`, 'g')))
        .map(match => weekdayNames.indexOf(match[1]));
      const times = Array.from(segment.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi))
        .filter(match => Number(match[1]) <= 12)
        .map(match => ({ hour: parseHour(match[1], match[3]), minute: Number(match[2] ?? 0) }));

      if (days.length && times.length) {
        const pairings = times.length === 1
          ? days.map(day => ({ day, ...times[0] }))
          : days.map((day, index) => ({ day, ...(times[index] ?? times[times.length - 1]) }));
        pairings.forEach(({ day, hour, minute }) => parsed.push({
          title: `Meet with ${mention.person.split(' ')[0]}`,
          person: mention.person,
          scheduledStart: nextWeekday(day, hour, minute, now),
          recurrence: lower.includes('every') || /\bmeet(?:ing)?\b/i.test(sentence) ? 'WEEKLY' : null,
          recurrenceDays: lower.includes('every') || /\bmeet(?:ing)?\b/i.test(sentence) ? [day] : undefined,
          estimatedMinutes: 30,
          priority: priorityFor(segment),
        }));
        return;
      }

      const action = segment.match(actionStart);
      const rawTitle=action ? segment.slice(action.index) : segment.replace(new RegExp(`^${mention.first}\\b`, 'i'), '');
      const title = stripSchedule(rawTitle), scheduledStart=relativeSchedule(segment,now);
      const recurrenceDays=repeatDaysFor(segment);
      if (title&&!/^(?:help me|remind me|not sure)$/i.test(title)) parsed.push({ title, person: mention.person, scheduledStart, recurrence: recurrenceDays.length?'WEEKLY':null,recurrenceDays:recurrenceDays.length?recurrenceDays:undefined,estimatedMinutes: durationFor(segment), priority: priorityFor(segment) });
    });
  }

  return parsed;
}
