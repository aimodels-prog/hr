import assert from "node:assert/strict";
import test from "node:test";
import {
  changedRecordFields,
  accessReasonRequired,
  changeReason,
  employmentReasonRequired,
  personalReasonRequired,
  trainingReasonRequired,
  vacancyReasonRequired,
} from "../src/lib/data/change-reason-policy.ts";

test("location-only edits ignore unchanged fields sent by the full employment form", () => {
  const before = {
    position: "Engineer",
    employmentType: "Permanent",
    location: "Office",
    grade: undefined,
  };
  const fields = changedRecordFields(before, { ...before, location: "Site", grade: "" });
  assert.deepEqual(fields, ["location"]);
  assert.equal(employmentReasonRequired(fields, "Confirmed"), false);
  assert.equal(
    changeReason("", false, "Employment details updated by HR"),
    "Employment details updated by HR",
  );
});

test("initial assignment notes are optional but compensation always requires a reason", () => {
  for (const status of ["Not Submitted", "Pending HR Review", "Changes Requested"]) {
    assert.equal(employmentReasonRequired(["position", "employmentType"], status), false);
    assert.equal(employmentReasonRequired(["salary"], status), true);
  }
  for (const field of ["salary", "grade", "employmentType", "weeklyHours", "startDate"]) {
    assert.equal(employmentReasonRequired(["location", field], "Confirmed"), true);
    assert.equal(employmentReasonRequired([field]), true);
  }
});

test("routine profile and family corrections are optional; legal identity changes require explanation", () => {
  assert.equal(
    personalReasonRequired(["phone", "address", "personalEmail", "emergencyContacts"]),
    false,
  );
  for (const field of ["dateOfBirth", "nationality", "dependants", "gender", "maritalStatus"]) {
    assert.equal(personalReasonRequired(["phone", field]), false);
  }
  for (const field of ["legalName"]) {
    assert.equal(personalReasonRequired(["phone", field]), true);
  }
});

test("routine employment and access edits need no explanation but Super Admin changes do", () => {
  for (const field of [
    "position",
    "positionId",
    "department",
    "departmentId",
    "lineManagerId",
    "location",
    "projectId",
  ])
    assert.equal(employmentReasonRequired([field], "Confirmed"), false);
  assert.equal(accessReasonRequired(["Employee"], ["Employee", "HR"], "Active", "Active"), false);
  assert.equal(
    accessReasonRequired(["Employee"], ["Employee", "Super Admin"], "Active", "Active"),
    true,
  );
  assert.equal(accessReasonRequired(["Super Admin"], ["Employee"], "Active", "Active"), true);
  assert.equal(accessReasonRequired(["Super Admin"], ["Super Admin"], "Active", "Suspended"), true);
  assert.equal(
    accessReasonRequired(["Super Admin"], ["Super Admin", "Line Manager"], "Active", "Active"),
    false,
  );
});

test("only free training and standard HR mandatory assignments waive justification", () => {
  for (const origin of ["Employee Request", "Supervisor Assignment", "HR Assignment"]) {
    assert.equal(trainingReasonRequired({ cost: "0", isMandatory: false }, origin), false);
    assert.equal(trainingReasonRequired({ cost: 150, isMandatory: false }, origin), true);
  }
  assert.equal(trainingReasonRequired({ cost: 150, isMandatory: true }, "HR Assignment"), false);
  assert.equal(trainingReasonRequired({ cost: 150, isMandatory: true }, "Employee Request"), true);
});

test("vacancy closure is routine only after the whole headcount has been hired", () => {
  assert.equal(vacancyReasonRequired("Open", "Closed", 2, 2), false);
  assert.equal(vacancyReasonRequired("Open", "Closed", 1, 2), true);
  assert.equal(vacancyReasonRequired("Open", "Closed", 0, 0), true);
  assert.equal(vacancyReasonRequired("Closed", "Archived", 0, 2), false);
  assert.equal(vacancyReasonRequired("Draft", "Closed", 0, 1), true);
  assert.equal(vacancyReasonRequired("Open", "Paused", 2, 2), true);
  assert.equal(vacancyReasonRequired("Paused", "Open", 0, 1), true);
});

test("automatic audit descriptions cannot substitute for required reasons", () => {
  for (const value of ["", "   ", "ok"])
    assert.throws(() => changeReason(value, true, "Automatic action"), /reason/);
  assert.equal(
    changeReason("  Corrected signed contract  ", true, "Automatic action"),
    "Corrected signed contract",
  );
  assert.equal(changeReason("OK", false, "Automatic action"), "OK");
});
