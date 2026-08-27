import { LocalRepository } from "./repository";
import type { ActorContext } from "./types";
import { getApplicationDataServices } from "./application-data";

export type GoalStatus = "Draft" | "Pending Approval" | "Active" | "Completed" | "Cancelled";

export interface EmployeeGoal {
  id: string;
  employeeId: string;
  cycleId: string; // The cycle it belongs to e.g. "2026 Annual"
  title: string;
  description: string;
  weight: number; // e.g. 1-100
  status: GoalStatus;
  
  // Auditing
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  recordVersion: number;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export class GoalService {
  private repo: LocalRepository<EmployeeGoal>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.repo = new LocalRepository<EmployeeGoal>("employeeGoals", storage, audit, { module: "hr", entityType: "employee-goal" });
  }

  getGoalsForEmployee(employeeId: string, cycleId?: string): EmployeeGoal[] {
    let goals = this.repo.list().filter(g => g.employeeId === employeeId);
    if (cycleId) {
      goals = goals.filter(g => g.cycleId === cycleId);
    }
    return goals;
  }

  getPendingGoalsForManager(managerId: string): EmployeeGoal[] {
    // In a real app we'd inject EmployeeService and check reports.
    // For now we assume the caller filters the list or we do it efficiently.
    // Actually, let's just return all pending goals and the UI will filter by manager.
    return this.repo.list().filter(g => g.status === "Pending Approval");
  }

  createGoal(goalData: Omit<EmployeeGoal, "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion">, context: ActorContext): EmployeeGoal {
    const goal: EmployeeGoal = {
      ...goalData,
      id: generateId(),
      createdAt: new Date().toISOString(),
      createdBy: context.actor.userId,
      updatedAt: new Date().toISOString(),
      updatedBy: context.actor.userId,
      recordVersion: 1,
    };
    return this.repo.create(goal, context);
  }

  updateGoal(id: string, updates: Partial<Omit<EmployeeGoal, "id" | "employeeId" | "createdAt" | "createdBy" | "recordVersion">>, context: ActorContext): EmployeeGoal {
    const goal = this.repo.getById(id);
    if (!goal) throw new Error("Goal not found");
    
    return this.repo.update(id, { ...goal, ...updates }, context);
  }

  submitForApproval(id: string, context: ActorContext): EmployeeGoal {
    return this.updateGoal(id, { status: "Pending Approval" }, context);
  }

  approveGoal(id: string, context: ActorContext): EmployeeGoal {
    return this.updateGoal(id, { status: "Active" }, context);
  }

  rejectGoal(id: string, context: ActorContext): EmployeeGoal {
    return this.updateGoal(id, { status: "Draft" }, context); // send back to draft
  }

  deleteGoal(id: string, context: ActorContext) {
    const goal = this.repo.getById(id);
    if (!goal) throw new Error("Goal not found");
    if (goal.status !== "Draft") {
      throw new Error("Only draft goals can be deleted. Once submitted or active, they must be cancelled.");
    }
    this.repo.archive(id, context);
  }
}
