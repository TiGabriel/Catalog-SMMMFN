import { DAY_NAMES } from "@/lib/format";
import { cn } from "@/lib/cn";

export type GridEntry = {
  id: string;
  dayOfWeek: number;
  room: string | null;
  groupLabel: string | null;
  timeSlot: { id: string; index: number; startTime: string; endTime: string };
  classSection: { id: string; code: string };
  subject: { id: string; name: string; shortName?: string | null };
  teacher: { firstName: string; lastName: string; rank?: { label: string } | null } | null;
};

/** Weekly timetable grid (desktop) with a per-day list on small screens. */
export function WeekGrid({
  slots,
  entries,
  showClass,
  showTeacher,
  cancelled = new Set<string>(),
}: {
  slots: { id: string; index: number; startTime: string; endTime: string }[];
  entries: GridEntry[];
  showClass: boolean;
  showTeacher: boolean;
  cancelled?: Set<string>;
}) {
  const days = [1, 2, 3, 4, 5, ...(entries.some((e) => e.dayOfWeek === 6) ? [6] : []), ...(entries.some((e) => e.dayOfWeek === 7) ? [7] : [])];
  const cell = (day: number, slotId: string) => entries.filter((e) => e.dayOfWeek === day && e.timeSlot.id === slotId);
  const Lesson = ({ e }: { e: GridEntry }) => (
    <div className={cn("rounded-xl border border-primary/15 bg-info-soft px-2.5 py-2 text-left transition-shadow hover:shadow-card", cancelled.has(e.id) && "line-through opacity-50")}>
      <p className="text-sm font-semibold leading-tight">{e.subject.name}</p>
      <p className="mt-0.5 text-xs text-muted">
        {[showClass ? `Clasa ${e.classSection.code}` : null, e.room ? `Sala ${e.room}` : null, e.groupLabel ? `Grupa ${e.groupLabel}` : null].filter(Boolean).join(" · ")}
      </p>
      {showTeacher && e.teacher && <p className="text-xs text-muted">{[e.teacher.rank?.label, e.teacher.lastName, e.teacher.firstName].filter(Boolean).join(" ")}</p>}
    </div>
  );

  return (
    <>
      <div className="hidden overflow-x-auto md:block print:block">
        <table className="data-table min-w-[760px] table-fixed">
          <thead>
            <tr>
              <th className="w-24">Ora</th>
              {days.map((d) => (
                <th key={d}>{DAY_NAMES[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id}>
                <td className="tabular align-top text-xs text-muted">
                  <span className="block font-semibold text-text">{s.index}</span>
                  {s.startTime}–{s.endTime}
                </td>
                {days.map((d) => (
                  <td key={d} className="align-top">
                    <div className="flex flex-col gap-1.5">
                      {cell(d, s.id).map((e) => (
                        <Lesson key={e.id} e={e} />
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-4 p-4 md:hidden print:hidden">
        {days.map((d) => {
          const list = entries.filter((e) => e.dayOfWeek === d).sort((a, b) => a.timeSlot.index - b.timeSlot.index);
          return (
            <div key={d}>
              <p className="mb-2 text-sm font-semibold">{DAY_NAMES[d]}</p>
              {list.length === 0 ? (
                <p className="text-sm text-muted">Fără ore</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {list.map((e) => (
                    <div key={e.id} className="flex gap-3">
                      <span className="tabular w-14 shrink-0 pt-2 text-xs text-muted">{e.timeSlot.startTime}</span>
                      <div className="flex-1">
                        <Lesson e={e} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
