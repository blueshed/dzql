export function analyzeDomain(domain: any) {
  const errors: string[] = [];
  const entities = domain.entities;
  const subscribables = domain.subscribables;

  // 1. Validate Subscribables
  for (const [subName, subConfig] of Object.entries(subscribables)) {
    const rootEntity = (subConfig as any).root?.entity;
    
    // Check root entity existence
    if (!rootEntity) {
      errors.push(`Subscribable '${subName}' missing root entity.`);
    } else if (!entities[rootEntity]) {
      errors.push(`Subscribable '${subName}' references unknown root entity '${rootEntity}'.`);
    }

    // Recursively check includes
    const validateIncludes = (includes: any, parentEntity: string) => {
      if (!includes) return;
      
      for (const [relName, relConfig] of Object.entries(includes)) {
        const targetEntity = typeof relConfig === 'string' 
            ? relConfig 
            : (relConfig as any).entity;

        if (!targetEntity) {
           errors.push(`Relation '${relName}' in '${subName}' missing target entity.`);
           continue;
        }
        if (!entities[targetEntity]) {
          errors.push(`Relation '${relName}' in '${subName}' references unknown entity '${targetEntity}'.`);
        }
        
        // TODO: Check if the FK relationship actually exists in the schema
        
        if ((relConfig as any).includes) {
          validateIncludes((relConfig as any).includes, targetEntity);
        }
      }
    };

    if ((subConfig as any).includes) {
      validateIncludes((subConfig as any).includes, rootEntity);
    }
  }

  return errors;
}
