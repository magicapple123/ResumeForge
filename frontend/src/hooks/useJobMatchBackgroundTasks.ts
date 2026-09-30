import { useEffect, useSyncExternalStore } from "react";
import {
  getJobMatchBackgroundTasks,
  restoreJobMatchBackgroundTasks,
  subscribeJobMatchBackgroundTasks,
  type JobMatchBackgroundTaskView,
} from "../utils/jobMatchBackgroundTasks";

export function useJobMatchBackgroundTasks(): JobMatchBackgroundTaskView[] {
  const tasks = useSyncExternalStore(
    subscribeJobMatchBackgroundTasks,
    getJobMatchBackgroundTasks,
    getJobMatchBackgroundTasks,
  );
  useEffect(() => {
    void restoreJobMatchBackgroundTasks();
  }, []);
  return tasks;
}
