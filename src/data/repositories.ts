import { Repository } from "./repository";
import type {
  ApiKey,
  Skill,
  SkillProjectConfig,
  McpServer,
  VolcCredential,
  GatewayConnection,
  AgentDefinition,
} from "@/types";

export const apiKeyRepo = new Repository<ApiKey>("apiKeys", "key");
export const skillRepo = new Repository<Skill>("skills", "skill");
export const skillProjectConfigRepo = new Repository<SkillProjectConfig>(
  "skillProjectConfigs",
  "skillproj"
);
export const mcpRepo = new Repository<McpServer>("mcpServers", "mcp");
export const volcCredentialRepo = new Repository<VolcCredential>(
  "volcCredentials",
  "volc"
);
export const gatewayConnectionRepo = new Repository<GatewayConnection>(
  "gatewayConnections",
  "gw"
);

export const agentDefinitionRepo = new Repository<AgentDefinition>(
  "agentDefinitions",
  "agent"
);
