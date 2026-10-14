import type { DomainConfig, EntityConfig, SubscribableConfig, IncludeConfig } from "../../shared/ir.js";

/**
 * Analyzes a domain configuration for errors and inconsistencies
 */
export function analyzeDomain(domain: DomainConfig): string[] {
  const errors: string[] = [];
  const entities = domain.entities;
  const subscribables = domain.subscribables || {};

  // 1. Validate Subscribables
  for (const [subName, subConfig] of Object.entries(subscribables)) {
    const rootEntity = subConfig.root?.entity;

    // Check root entity existence
    if (!rootEntity) {
      errors.push(`Subscribable '${subName}' missing root entity.`);
    } else if (!entities[rootEntity]) {
      errors.push(`Subscribable '${subName}' references unknown root entity '${rootEntity}'.`);
    }

    // Recursively check includes
    const validateIncludes = (includes: Record<string, string | IncludeConfig> | undefined, parentEntity: string) => {
      if (!includes) return;

      for (const [relName, relConfig] of Object.entries(includes)) {
        const targetEntity = typeof relConfig === 'string'
            ? relConfig
            : relConfig.entity;

        if (!targetEntity) {
           errors.push(`Relation '${relName}' in '${subName}' missing target entity.`);
           continue;
        }
        if (!entities[targetEntity]) {
          errors.push(`Relation '${relName}' in '${subName}' references unknown entity '${targetEntity}'.`);
        }

        // Recursively validate nested includes
        if (typeof relConfig !== 'string' && relConfig.includes) {
          validateIncludes(relConfig.includes, targetEntity);
        }
      }
    };

    if (subConfig.includes) {
      validateIncludes(subConfig.includes, rootEntity);
    }
  }

  return errors;
}
