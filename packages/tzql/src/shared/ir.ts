export interface EntityIR {
  name: string;
  table: string;
  primaryKey: string[];
  columns: Array<{ name: string; type: string; isArray: boolean }>;
  labelField?: string;
  softDelete?: boolean;
  managed?: boolean; // If false, skip CRUD function generation (for junction tables)
  hidden?: string[]; // Fields to exclude from query results (e.g., password_hash)
  fieldDefaults?: Record<string, string>;
  permissions: {
    view: string[];
    create: string[];
    update: string[];
    delete: string[];
  };
  relationships: Record<string, RelationshipIR>;
  manyToMany: Record<string, ManyToManyIR>;
  graphRules: {
    onCreate: GraphRuleIR[];
    onUpdate: GraphRuleIR[];
    onDelete: GraphRuleIR[];
  };
}

export interface ManyToManyIR {
  junctionTable: string;
  localKey: string;
  foreignKey: string;
  targetEntity: string;
  idField: string;
  expand: boolean;
}

export interface RelationshipIR {
  type: 'one_to_many' | 'many_to_one' | 'many_to_many';
  targetEntity: string;
  localKey: string;
  foreignKey: string;
}

export interface GraphRuleIR {
  trigger: 'create' | 'update' | 'delete';
  action: 'create' | 'update' | 'delete' | 'reactor';
  target: string; // entity name or reactor name
  params: Record<string, string>; // e.g. { user_id: '@user_id' }
}

export interface SubscribableIR {
  name: string;
  params: Record<string, string>;
  root: {
    entity: string;
    key: string;
  };
  includes: Record<string, IncludeIR>;
  scopeTables: string[];
  canSubscribe: string[]; // Permission paths
}

export interface IncludeIR {
  relation: string; // The key (e.g., 'sites')
  entity: string; // The target table (e.g., 'sites')
  filter?: Record<string, string>;
  includes?: Record<string, IncludeIR>; // Nested includes
}

export interface CustomFunctionIR {
  name: string;
  sql: string;
  args?: string[];  // For manifest allowlist
}

export interface DomainIR {
  entities: Record<string, EntityIR>;
  subscribables: Record<string, SubscribableIR>;
  customFunctions: CustomFunctionIR[];
}
