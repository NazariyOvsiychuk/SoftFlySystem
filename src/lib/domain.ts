export type AppRole = "admin" | "employee";

export type ScheduleDayType = "required" | "preferred" | "off";

export type ShiftStatus = "open" | "closed" | "flagged";

export type ViolationType =
  | "missed_required_day"
  | "late_check_in"
  | "early_check_out"
  | "no_check_out";

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  isActive: boolean;
}

export interface ScheduleDay {
  id: string;
  employeeId: string;
  workDate: string;
  dayType: ScheduleDayType;
  expectedStart?: string | null;
  expectedEnd?: string | null;
}

export interface Shift {
  id: string;
  employeeId: string;
  shiftDate: string;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes?: number | null;
  status: ShiftStatus;
}
