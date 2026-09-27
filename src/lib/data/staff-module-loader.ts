import { STAFF_MODULE_DEPENDENCIES, type StaffModule } from "./staff-module-plan.ts";

export type ModuleState = { status: "loading" | "ready" | "error"; error?: string };
type Load = (module: StaffModule, canCommit: () => boolean) => Promise<void>;

/** Session/role-owned cache coordinator. A failed or stalled module never blocks its neighbours. */
export class StaffModuleLoader {
  private state: Partial<Record<StaffModule, ModuleState>> = {};
  private listeners = new Set<() => void>();
  private requests = new Map<StaffModule, Promise<void>>();
  private queue: Array<() => void> = [];
  private running = 0;
  private disposed = false;
  private cancelActive = new Set<() => void>();
  constructor(
    private load: Load,
    private timeoutMs = 20_000,
    private concurrency = 3,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(module: StaffModule, value: ModuleState) {
    if (this.disposed) return;
    this.state = { ...this.state, [module]: value };
    this.listeners.forEach((listener) => listener());
  }
  private pump() {
    while (this.running < this.concurrency && this.queue.length) this.queue.shift()!();
  }
  ensure(modules: readonly StaffModule[]): Promise<void> {
    return Promise.all(modules.map((module) => this.ensureOne(module))).then(() => undefined);
  }
  private ensureOne(module: StaffModule): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Workspace changed."));
    if (this.state[module]?.status === "ready") return Promise.resolve();
    const pending = this.requests.get(module);
    if (pending) return pending;
    if (this.state[module]?.status === "error")
      return Promise.reject(new Error(this.state[module].error));
    const request = Promise.resolve()
      .then(() => this.ensure(STAFF_MODULE_DEPENDENCIES[module] ?? []))
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            const start = () => {
              if (this.disposed) {
                reject(new Error("Workspace changed."));
                return;
              }
              this.running++;
              let valid = true;
              const finish = (outcome: { ok: true } | { ok: false; error: unknown }) => {
                if (!valid) return;
                valid = false;
                clearTimeout(timer);
                this.cancelActive.delete(cancel);
                this.running--;
                this.pump();
                if (outcome.ok) resolve();
                else reject(outcome.error);
              };
              const cancel = () => finish({ ok: false, error: new Error("Workspace changed.") });
              this.cancelActive.add(cancel);
              const timer = setTimeout(
                () =>
                  finish({
                    ok: false,
                    error: new Error(
                      `${module[0]!.toUpperCase()}${module.slice(1)} took too long to load. Try again.`,
                    ),
                  }),
                this.timeoutMs,
              );
              Promise.resolve()
                .then(() => this.load(module, () => valid && !this.disposed))
                .then(
                  () => finish({ ok: true }),
                  (error: unknown) => finish({ ok: false, error }),
                );
            };
            this.queue.push(start);
            this.pump();
          }),
      )
      .then(
        () => {
          this.requests.delete(module);
          this.publish(module, { status: "ready" });
        },
        (error: unknown) => {
          this.requests.delete(module);
          this.publish(module, {
            status: "error",
            error: error instanceof Error ? error.message : "This section could not be loaded.",
          });
          throw error;
        },
      );
    this.requests.set(module, request);
    this.publish(module, { status: "loading" });
    return request;
  }
  retry(modules: readonly StaffModule[]) {
    const reset = (module: StaffModule) => {
      for (const dependency of STAFF_MODULE_DEPENDENCIES[module] ?? []) reset(dependency);
      if (this.state[module]?.status === "error") {
        const next = { ...this.state };
        delete next[module];
        this.state = next;
      }
    };
    modules.forEach(reset);
    return this.ensure(modules);
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
    for (const cancel of this.cancelActive) cancel();
    this.pump();
  }
}
