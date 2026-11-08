import type { AgentIdentity, RegistryKind } from "@ato/core";

/** A registry identity plus display metadata the scorer doesn't need. */
export type RegistryAgent = AgentIdentity & { agentUri?: string };

/**
 * Pluggable identity layer. The oracle runs no identity system of its own: it reads
 * whichever registries agents already use. Add a provider to support a new registry (SATI,
 * a cross-chain 8004 mirror, or a host network's own identity layer).
 */
export interface IdentityProvider {
  readonly registry: RegistryKind;
  listAgents(): AsyncIterable<RegistryAgent>;
}
