import { LocalRepository } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type { MasterRecord, Project } from "./types.ts";

export type MasterDataCollection =
  | "departments"
  | "locations"
  | "costCentres"
  | "positions"
  | "grades"
  | "employmentTypes"
  | "workingTimes"
  | "publicHolidays"
  | "currencies"
  | "activityCodes";

export function getMasterDataRepository(collection: MasterDataCollection) {
  const { storage, audit } = getApplicationDataServices();
  return new LocalRepository<MasterRecord>(collection, storage, audit, {
    module: "settings",
    entityType: collection,
  });
}

export function getProjectRepository() {
  const { storage, audit } = getApplicationDataServices();
  return new LocalRepository<Project>("projects", storage, audit, {
    module: "settings",
    entityType: "project",
  });
}
