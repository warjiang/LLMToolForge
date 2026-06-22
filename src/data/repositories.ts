import { Repository } from "./repository";
import type {
  ApiKey,
  Skill,
  McpServer,
  VolcCredential,
  GatewayConnection,
} from "@/types";

export const apiKeyRepo = new Repository<ApiKey>("apiKeys", "key");
export const skillRepo = new Repository<Skill>("skills", "skill");
export const mcpRepo = new Repository<McpServer>("mcpServers", "mcp");
export const volcCredentialRepo = new Repository<VolcCredential>(
  "volcCredentials",
  "volc"
);
export const gatewayConnectionRepo = new Repository<GatewayConnection>(
  "gatewayConnections",
  "gw"
);
