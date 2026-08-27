import {
  LocalAiProvider,
  LocalCalendarProvider,
  LocalEmailProvider,
  LocalMeetingProvider,
  LocalWorkspaceIdentityProvider,
} from "./local-providers.ts";
import type { IntegrationProviderRegistry } from "./types.ts";

function createLocalRegistry(): IntegrationProviderRegistry {
  return {
    ai: new LocalAiProvider(),
    email: new LocalEmailProvider(),
    calendar: new LocalCalendarProvider(),
    meeting: new LocalMeetingProvider(),
    workspaceIdentity: new LocalWorkspaceIdentityProvider(),
  };
}

let registry = createLocalRegistry();

export function getIntegrationProviderRegistry(): IntegrationProviderRegistry {
  return registry;
}

export function configureIntegrationProviders(
  overrides: Partial<IntegrationProviderRegistry>,
): IntegrationProviderRegistry {
  registry = { ...registry, ...overrides };
  return registry;
}

export function resetIntegrationProviders(): IntegrationProviderRegistry {
  registry = createLocalRegistry();
  return registry;
}
