import { createContext, useContext } from "react";

// Bumped once per "repo" stream event for the current company; GraphPage may read it later to refetch.
export const LiveContext = createContext<number>(0);

export function useLiveRevision(): number {
  return useContext(LiveContext);
}
