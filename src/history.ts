import { clonePlan, samePlan } from "./plan";
import type { Plan } from "./types";

const MAX_STEPS = 80;

export class History {
  private past: Plan[] = [];
  private future: Plan[] = [];
  private present: Plan;

  constructor(initial: Plan) {
    this.present = clonePlan(initial);
  }

  current(): Plan {
    return this.present;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Returns true when the committed plan actually changed. */
  commit(next: Plan): boolean {
    const snapshot = clonePlan(next);
    if (samePlan(this.present, snapshot)) return false;
    this.past.push(this.present);
    if (this.past.length > MAX_STEPS) this.past.shift();
    this.present = snapshot;
    this.future = [];
    return true;
  }

  undo(): Plan {
    const previous = this.past.pop();
    if (!previous) return this.present;
    this.future.push(this.present);
    this.present = previous;
    return this.present;
  }

  redo(): Plan {
    const next = this.future.pop();
    if (!next) return this.present;
    this.past.push(this.present);
    this.present = next;
    return this.present;
  }
}
