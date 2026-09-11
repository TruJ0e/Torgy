import { describe, expect, it } from 'vitest';
import { parseInfoDump } from './info-dump';

describe('info dump parser', () => {
  it('separates students, recurring meetings, and personal tasks', () => {
    const result = parseInfoDump(
      'i meet with jake every tuesday and thursday at 5 and emily at 3pm on monday, 8 am on tuesday, 4:30pm on wednesday.\nI also have to get groceries after im off work and find a time to email my mom',
      ['Jake Brown', 'Emily Jones'],
      'Alex Advisor',
      new Date('2026-08-29T12:00:00-05:00'),
    );

    expect(result).toHaveLength(7);
    expect(result.filter(task => task.person === 'Jake Brown')).toHaveLength(2);
    expect(result.filter(task => task.person === 'Emily Jones')).toHaveLength(3);
    expect(result.filter(task => task.person === 'Alex Advisor')).toHaveLength(2);
    expect(result.filter(task => task.recurrence === 'WEEKLY')).toHaveLength(5);
    expect(result.find(task => task.title === "Get groceries after I'm off work")?.scheduledStart).toBeNull();
  });

  it('understands relative dates and removes non-task filler', () => {
    const result=parseInfoDump(
      'sarah bio test at one today. study for chem chap five tomorrow morning. next week i have doc in fort smith. my team plays at the end of the month around 4300. not sure when car goes to shop. help me',
      ['Sarah Johnson'],
      'Alex Advisor',
      new Date('2026-08-29T12:00:00-05:00'),
    );
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({title:'Biology test',person:'Sarah Johnson',priority:'High'});
    expect(result[0].scheduledStart).toBe('2026-08-29T18:00:00.000Z');
    expect(result[1].scheduledStart).toBe('2026-08-30T13:00:00.000Z');
    expect(result[2].scheduledStart).toBe('2026-08-31T14:00:00.000Z');
    expect(result[3].scheduledStart).toBe('2026-08-31T21:30:00.000Z');
    expect(result[4].scheduledStart).toBeNull();
  });

  it('corrects common spelling, shortens filler, and assigns everything to the selected student', () => {
    const result=parseInfoDump(
      'study for chem chap five tommorow morning. find a time to emial mom. important bio test today',
      ['Sarah Johnson'],
      'Sarah Johnson',
      new Date('2026-08-29T12:00:00-05:00'),
    );
    expect(result.map(task=>task.person)).toEqual(['Sarah Johnson','Sarah Johnson','Sarah Johnson']);
    expect(result.map(task=>task.title)).toEqual(['Study Chemistry Chapter 5','Email mom','Biology test']);
    expect(result[2].priority).toBe('High');
    expect(result[0].scheduledStart).toBe('2026-08-30T13:00:00.000Z');
  });

  it('corrects rough spelling, understands time concepts, repeat days, and necessities',()=>{
    const result=parseInfoDump(
      "need food today\ntomorrow no school\ni should brush my teeth every morning\nnext week i have to study with friends\ni think theres smtnhg for hystory",
      ['Sarah Johnson'],
      'Sarah Johnson',
      new Date('2026-08-29T12:00:00-05:00'),
    );
    expect(result.map(task=>task.title)).toEqual(['Need food','No school','Brush my teeth','Study with friends',"Think there's something for history"]);
    expect(result[0]).toMatchObject({priority:'High',scheduledStart:'2026-08-29T17:30:00.000Z'});
    expect(result[1]).toMatchObject({estimatedMinutes:480,scheduledStart:'2026-08-30T14:00:00.000Z'});
    expect(result[2]).toMatchObject({recurrence:'WEEKLY',recurrenceDays:[0,1,2,3,4,5,6],scheduledStart:'2026-08-30T13:00:00.000Z'});
    expect(result[3].scheduledStart).toBe('2026-08-31T14:00:00.000Z');
  });
});
