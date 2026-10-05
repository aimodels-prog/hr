export const OFFICE_EXCEPTION_TYPES = [
  "Company programme",
  "Training",
  "Approved remote work",
  "Excused closure",
] as const;
export type OfficeExceptionType = (typeof OFFICE_EXCEPTION_TYPES)[number];
export interface OfficeCredit {
  organisationId: string;
  createdBy: string;
  createdAt: Date;
  id: string;
  employeeId: string;
  date: string;
  label: string;
  hours: number;
}
