import { AGENT_ROUTE_PATH } from "@/lib/routes";

export function runAgentRouteTests() {
  console.assert(AGENT_ROUTE_PATH === "agent", "agent route path should be /agent");
}
