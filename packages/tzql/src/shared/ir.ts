// ============================================
// INPUT TYPES - Used for domain configuration
// ============================================

/** Action types supported in graph rules */
export type GraphRuleActionType = 'create' | 'update' | 'delete' | 'validate' | 'execute' | 'reactor';

/** Configuration for a graph rule action */
export interface GraphRuleActionConfig {
  type: GraphRuleActionType;
  entity?: string;           // Target entity for create action
  target?: string;           // Target entity for update/delete actions
  name?: string;             // Reactor name for reactor type
  function?: string;         // Function name for validate/execute
  data?: Record<string, string | null>;   // Data for create/update (field -> @variable or null)
  match?: Record<string, string>;  // Match condition for update/delete
  params?: Record<string, string>; // Parameters for reactor/validate/execute
  error_message?: string;    // Error message for validate
}

/** Configuration for a named graph rule */
export interface GraphRuleConfig {
  description?: string;
  condition?: string;        // e.g., "@before.status = 'draft' AND @after.status = 'posted'"
  actions: GraphRuleActionConfig[];
}

/** Include configuration - either a simple string (entity name) or full object */
export interface IncludeConfig {
  entity: string;
  filter?: Record<string, string>;
  includes?: Record<string, string | IncludeConfig>;
  temporal?: boolean;  // Only include active temporal records
}

/** Many-to-many relationship configuration */
export interface ManyToManyConfig {
  junctionTable: string;
  localKey: string;
  foreignKey: string;
  targetEntity: string;
  idField: string;
  expand?: boolean;
}

/** Permission paths configuration */
export interface PermissionPathsConfig {
  view?: string[];
  create?: string[];
  update?: string[];
  delete?: string[];
}

/** Temporal fields configuration */
export interface TemporalConfig {
  validFrom: string;
  validTo: string;
}

/** Graph rules grouped by trigger */
export interface GraphRulesConfig {
  on_create?: Record<string, GraphRuleConfig>;
  on_update?: Record<string, GraphRuleConfig>;
  on_delete?: Record<string, GraphRuleConfig>;
  primary_key?: string[];    // Composite primary key fields
  many_to_many?: Record<string, ManyToManyConfig>;
}

/** Entity configuration as provided in domain file */
export interface EntityConfig {
  schema: Record<string, string>;
  label?: string;
  searchable?: string[];
  hidden?: string[];
  primaryKey?: string[];
  managed?: boolean;
  softDelete?: boolean;
  fieldDefaults?: Record<string, string>;
  permissions?: PermissionPathsConfig;
  includes?: Record<string, string | IncludeConfig>;
  manyToMany?: Record<string, ManyToManyConfig>;
  graphRules?: GraphRulesConfig;
  temporal?: TemporalConfig;
  constraints?: string[];
  indexes?: string[];
  notifications?: Record<string, string[]>;
}

/** Subscribable configuration as provided in domain file */
export interface SubscribableConfig {
  params: Record<string, string>;
  root: { entity: string; key: string };
  includes?: Record<string, string | IncludeConfig>;
  scopeTables?: string[];
  canSubscribe?: string[];
}

/** Custom function configuration */
export interface CustomFunctionConfig {
  name: string;
  sql: string;
  args?: string[];
}

/** Complete domain configuration as provided in domain file */
export interface DomainConfig {
  entities: Record<string, EntityConfig>;
  subscribables?: Record<string, SubscribableConfig>;
  customFunctions?: CustomFunctionConfig[];
}

// ============================================
// IR TYPES - Intermediate representation
// ============================================

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
  action: 'create' | 'update' | 'delete' | 'reactor' | 'validate' | 'execute';
  target: string; // entity name, reactor name, or function name
  ruleName?: string; // The name of the rule (for comments)
  description?: string; // Human-readable description
  condition?: string; // e.g., "@before.status = 'draft' AND @after.status = 'posted'"
  params: Record<string, string | null>; // Data for create, or params for reactor/validate/execute
  match?: Record<string, string>; // WHERE clause for update/delete actions
  error_message?: string; // Error message for validate action
}

export interface SubscribableIR {
  name: string;
  params: Record<string, string>;
  root: {
    entity: string;
    key: string;
    filter?: Record<string, string | boolean | number>;
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
