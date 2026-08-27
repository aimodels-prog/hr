import type { BaseRecord, RecordId } from "./types";

export type AssetType = "Laptop" | "Desktop" | "Monitor" | "Phone" | "SIM Card" | "Access Card" | "Vehicle" | "Other";
export type AssetCondition = "New" | "Good" | "Fair" | "Damaged";
export type AssetAssignmentStatus = "Assigned" | "Returned" | "Lost" | "Damaged";

export interface AssetAssignment extends BaseRecord {
  employeeId: RecordId;
  assetType: AssetType;
  assetTag?: string | undefined; // serial number / inventory tag
  description: string;
  assignedDate: string;
  conditionAtAssignment: AssetCondition;
  status: AssetAssignmentStatus;
  returnedDate?: string | undefined;
  returnCondition?: AssetCondition | undefined;
  notes?: string | undefined;
}
