import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import type { AuditActorContext } from "../src/lib/db/repositories/master-data.repository.server.ts";
import {
  assignCompanyAssetInDatabase,
  closeCompanyAssetAssignmentInDatabase,
  listAvailableCompanyAssets,
  listCompanyAssetAssignmentsForActor,
} from "../src/lib/db/repositories/company-asset.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "returned equipment is safely reassigned without replacing its history",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname.toLowerCase(), /(test|scratch)/);
    const query = postgres(databaseUrl!, { max: 5, prepare: false });
    const org = randomUUID(),
      author = randomUUID();
    const department = randomUUID(),
      position = randomUUID(),
      location = randomUUID(),
      employmentType = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    try {
      await query`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by)
      VALUES (${org},'Equipment test',${`equipment-${org}`},false,${author},${author})`;
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["locations", location],
        ["employment_types", employmentType],
      ] as const) {
        await query.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        VALUES ($1,$2,'Test','TEST',true,1,$3,$3)`,
          [id, org, author],
        );
      }
      const person = async (
        role: AuditActorContext["activeRole"],
        managerId: string | null = null,
      ): Promise<AuditActorContext> => {
        const employeeId = randomUUID(),
          userId = randomUUID();
        await query`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,
        department_id,position_id,location_id,employment_type_id,line_manager_id,status,start_date,created_by,updated_by)
        VALUES (${employeeId},${org},${employeeId},${role},${role},${`${employeeId}@viahr.test`},
          ${department},${position},${location},${employmentType},${managerId},'Active','2019-01-01',${author},${author})`;
        await query`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by)
        VALUES (${userId},${org},${employeeId},${role},${`${employeeId}@viahr.test`},'Active',${author},${author})`;
        return {
          userId,
          employeeId,
          displayName: role,
          activeRole: role,
          roles: ["Employee", role],
        };
      };
      const hr = await person("HR"),
        secondHr = await person("HR"),
        admin = await person("Super Admin");
      const manager = await person("Line Manager"),
        firstEmployee = await person("Employee", manager.employeeId!),
        secondEmployee = await person("Employee");
      const finance = await person("Accounts"),
        it = await person("IT");
      const input = (employeeId = firstEmployee.employeeId!) => ({
        employeeId,
        assetType: "Laptop" as const,
        assetTag: `TEST-${randomUUID()}`,
        description: "Test laptop",
        assignedDate: today,
        conditionAtAssignment: "New" as const,
      });
      const fixture = async () => {
        const data = input();
        const id = await assignCompanyAssetInDatabase(org, data, hr);
        const [assignment] = await query`SELECT * FROM asset_assignments WHERE id=${id}`;
        return { id, assetId: assignment!.asset_id as string, data };
      };
      const returnItem = (id: string) =>
        closeCompanyAssetAssignmentInDatabase(org, id, "Returned", "Good", "Returned complete", hr);
      const assetRow = async (id: string) =>
        (await query`SELECT * FROM company_assets WHERE id=${id}`)[0]!;
      const assignmentRow = async (id: string) =>
        (await query`SELECT * FROM asset_assignments WHERE id=${id}`)[0]!;
      const reassign = async (
        assetId: string,
        expectedVersion = 2,
        employeeId = secondEmployee.employeeId!,
        actor = hr,
        assignedDate = today,
      ) =>
        assignCompanyAssetInDatabase(
          org,
          { assetId, expectedVersion, employeeId, assignedDate },
          actor,
        );

      await t.test(
        "return exposes the existing item; reassign creates a separate handover",
        async () => {
          const item = await fixture();
          assert.equal(
            (await listAvailableCompanyAssets(org, hr)).some((a) => a.id === item.assetId),
            false,
          );
          await returnItem(item.id);
          const original = await assignmentRow(item.id);
          const available = (await listAvailableCompanyAssets(org, hr)).find(
            (a) => a.id === item.assetId,
          )!;
          assert.equal(available.currentCondition, "Good");
          assert.equal(available.lastReturnedDate, today);
          assert.equal(available.recordVersion, 2);
          await assert.rejects(
            assignCompanyAssetInDatabase(org, item.data, hr),
            /already registered/,
          );
          const nextId = await reassign(item.assetId);
          assert.notEqual(nextId, item.id);
          assert.deepEqual(await assignmentRow(item.id), original);
          const next = await assignmentRow(nextId);
          assert.equal(next.asset_id, item.assetId);
          assert.equal(next.employee_id, secondEmployee.employeeId);
          assert.equal(next.condition_at_assignment, "Good");
          assert.equal((await assetRow(item.assetId)).status, "Assigned");
          assert.equal(
            (await listAvailableCompanyAssets(org, hr)).some((a) => a.id === item.assetId),
            false,
          );
          await assert.rejects(returnItem(item.id), /Only assigned/);
          assert.equal((await assignmentRow(nextId)).status, "Assigned");
          await returnItem(nextId);
          await reassign(item.assetId, 4, firstEmployee.employeeId!, admin);
          assert.equal(
            (await query`SELECT * FROM company_assets WHERE id=${item.assetId}`).length,
            1,
          );
          const history = (await listCompanyAssetAssignmentsForActor(org, hr)).filter(
            (a) => a.assetId === item.assetId,
          );
          assert.equal(history.length, 3);
          assert.equal(history.filter((a) => a.status === "Assigned").length, 1);
          const audits =
            await query`SELECT * FROM audit_events WHERE entity_id=${item.assetId} AND action='assign'`;
          assert.equal(audits.length, 3);
          assert.equal(audits.filter((a) => a.after_summary.reusedExistingAsset).length, 2);
        },
      );

      await t.test(
        "two HR staff cannot allocate the same item twice; stale screens are rejected",
        async () => {
          const item = await fixture();
          await returnItem(item.id);
          const results = await Promise.allSettled([
            reassign(item.assetId),
            reassign(item.assetId, 2, firstEmployee.employeeId!, secondHr),
          ]);
          assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
          const loser = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
          assert.match(loser.reason.message, /changed/);
          const assigned =
            await query`SELECT * FROM asset_assignments WHERE asset_id=${item.assetId} AND status='Assigned'`;
          assert.equal(assigned.length, 1);
          await assert.rejects(
            query`INSERT INTO asset_assignments (organisation_id,asset_id,employee_id,assigned_date,condition_at_assignment,status,created_by,updated_by)
        VALUES (${org},${item.assetId},${secondEmployee.employeeId!},${today},'Good','Assigned',${author},${author})`,
            /asset_assignments_one_current_unique/,
          );
          await returnItem(assigned[0]!.id);
          await assert.rejects(reassign(item.assetId, 2), /changed/);
          assert.equal((await assetRow(item.assetId)).status, "Available");
        },
      );

      await t.test(
        "role, tenant and employee boundaries apply to availability and assignment",
        async () => {
          const item = await fixture();
          await returnItem(item.id);
          for (const actor of [
            firstEmployee,
            manager,
            finance,
            it,
            { ...hr, activeRole: "Employee" as const },
          ]) {
            await assert.rejects(listAvailableCompanyAssets(org, actor), /Only HR/);
            await assert.rejects(
              reassign(item.assetId, 2, secondEmployee.employeeId!, actor),
              /Only HR/,
            );
            await assert.rejects(
              closeCompanyAssetAssignmentInDatabase(org, item.id, "Returned", "Good", "", actor),
              /Only HR/,
            );
          }
          assert.deepEqual(await listAvailableCompanyAssets(randomUUID(), hr), []);
          await assert.rejects(
            assignCompanyAssetInDatabase(
              randomUUID(),
              {
                assetId: item.assetId,
                expectedVersion: 2,
                employeeId: secondEmployee.employeeId!,
                assignedDate: today,
              },
              hr,
            ),
            /organisation/,
          );
          await assert.rejects(reassign(randomUUID()), /not found/);
          await assert.rejects(reassign(item.assetId, 2, randomUUID()), /organisation/);
          const inactive = await person("Employee");
          await query`UPDATE employees SET status='Inactive',record_version=record_version+1 WHERE id=${inactive.employeeId!}`;
          await assert.rejects(reassign(item.assetId, 2, inactive.employeeId!), /current employee/);
          await reassign(item.assetId);
          assert.equal(
            (await listCompanyAssetAssignmentsForActor(org, firstEmployee)).some(
              (a) => a.employeeId !== firstEmployee.employeeId,
            ),
            false,
          );
          assert.equal(
            (await listCompanyAssetAssignmentsForActor(org, manager)).some(
              (a) => a.employeeId === secondEmployee.employeeId,
            ),
            false,
          );
          assert.equal(
            (await listCompanyAssetAssignmentsForActor(org, secondEmployee)).filter(
              (a) => a.assetId === item.assetId,
            ).length,
            1,
          );
        },
      );

      await t.test(
        "lost, damaged, retired, archived or still-issued items cannot be reused",
        async () => {
          for (const outcome of ["Lost", "Damaged", "Returned"] as const) {
            const item = await fixture();
            await closeCompanyAssetAssignmentInDatabase(
              org,
              item.id,
              outcome,
              "Damaged",
              "Broken screen",
              hr,
            );
            assert.equal(
              (await assetRow(item.assetId)).status,
              outcome === "Lost" ? "Lost" : "Damaged",
            );
            assert.equal(
              (await listAvailableCompanyAssets(org, hr)).some((a) => a.id === item.assetId),
              false,
            );
            await assert.rejects(reassign(item.assetId), /undamaged/);
          }
          for (const kind of ["Retired", "Archived", "LegacyDamaged", "StillIssued"] as const) {
            const item = await fixture();
            if (kind !== "StillIssued") await returnItem(item.id);
            if (kind === "Archived")
              await query`UPDATE company_assets SET archived_at=now(),record_version=record_version+1 WHERE id=${item.assetId}`;
            if (kind === "Retired")
              await query`UPDATE company_assets SET status='Retired',record_version=record_version+1 WHERE id=${item.assetId}`;
            if (kind === "LegacyDamaged")
              await query`UPDATE company_assets SET current_condition='Damaged',record_version=record_version+1 WHERE id=${item.assetId}`;
            // A legacy inconsistent Available row must not bypass the active assignment check.
            if (kind === "StillIssued")
              await query`UPDATE company_assets SET status='Available',record_version=record_version+1 WHERE id=${item.assetId}`;
            assert.equal(
              (await listAvailableCompanyAssets(org, hr)).some((a) => a.id === item.assetId),
              false,
            );
            await assert.rejects(
              reassign(item.assetId, (await assetRow(item.assetId)).record_version),
              /not found|undamaged|already assigned/,
            );
          }
          await assert.rejects(
            assignCompanyAssetInDatabase(org, { ...input(), conditionAtAssignment: "Damaged" }, hr),
            /Damaged equipment/,
          );
        },
      );

      await t.test("handover cannot predate the return or be scheduled in the future", async () => {
        const item = await fixture();
        await returnItem(item.id);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        await assert.rejects(
          reassign(item.assetId, 2, secondEmployee.employeeId!, hr, yesterday),
          /latest return/,
        );
        await assert.rejects(
          reassign(item.assetId, 2, secondEmployee.employeeId!, hr, tomorrow),
          /future date/,
        );
        await assert.rejects(
          reassign(item.assetId, 2, secondEmployee.employeeId!, hr, "2026-02-30"),
          /valid assignment date/,
        );
        assert.equal((await assetRow(item.assetId)).status, "Available");
      });

      await t.test("failed assignment leaves the inventory and old history untouched", async () => {
        const item = await fixture();
        await returnItem(item.id);
        const beforeAsset = await assetRow(item.assetId),
          beforeAssignment = await assignmentRow(item.id);
        const constraint = `test_asset_failure_${randomUUID().replaceAll("-", "")}`;
        await query.unsafe(
          `ALTER TABLE asset_assignments ADD CONSTRAINT ${constraint} CHECK (asset_id <> '${item.assetId}' OR status <> 'Assigned')`,
        );
        try {
          await assert.rejects(reassign(item.assetId));
          assert.deepEqual(await assetRow(item.assetId), beforeAsset);
          assert.deepEqual(await assignmentRow(item.id), beforeAssignment);
          assert.equal(
            (
              await query`SELECT * FROM audit_events WHERE entity_id=${item.assetId} AND action='assign'`
            ).length,
            1,
          );
        } finally {
          await query.unsafe(`ALTER TABLE asset_assignments DROP CONSTRAINT ${constraint}`);
        }
      });
    } finally {
      await query.end({ timeout: 5 });
      await closeDatabaseConnection();
    }
  },
);
