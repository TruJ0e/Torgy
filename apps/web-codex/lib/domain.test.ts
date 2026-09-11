import {describe,expect,it} from 'vitest';
import {hasConflict,isOverdue,nextOccurrence,Proposal,recurringMovePlan,TaskInput} from './domain';
describe('task domain',()=>{
 it('detects overdue open tasks',()=>expect(isOverdue({dueAt:'2025-01-01T00:00:00.000Z',status:'TODO'},new Date('2025-01-02'))).toBe(true));
 it('does not flag completed tasks overdue',()=>expect(isOverdue({dueAt:'2025-01-01T00:00:00.000Z',status:'COMPLETED'},new Date('2025-01-02'))).toBe(false));
 it('generates a new recurrence instance date',()=>expect(nextOccurrence('2025-01-06T10:00:00.000Z','WEEKLY')).toBe('2025-01-13T10:00:00.000Z'));
 it('moves one recurring occurrence without moving the series',()=>expect(recurringMovePlan('WEEKLY',['2026-08-23'],'2026-08-30')).toEqual({detach:true,exceptions:['2026-08-23','2026-08-30']}));
 it('finds schedule conflicts',()=>expect(hasConflict('2025-01-01T10:30:00Z','2025-01-01T11:30:00Z',[{startAt:'2025-01-01T10:00:00Z',endAt:'2025-01-01T11:00:00Z'}])).toBe(true));
 it('validates tasks and proposals',()=>{expect(TaskInput.safeParse({title:'Register',ownerUserId:'sarah'}).success).toBe(true);expect(Proposal.safeParse({tasks:[{title:'Register'}],events:[]}).success).toBe(true)});
});
