import { EntityIR, SubscribableIR } from "../../shared/ir.js";

const TYPE_MAP: Record<string, string> = {
  'text': 'string',
  'int': 'number',
  'integer': 'number',
  'serial': 'number',
  'bigint': 'number', // JS numbers are doubles, usually fine for IDs, or use string/bigint
  'boolean': 'boolean',
  'jsonb': 'any',
  'timestamptz': 'string',
  'date': 'string',
  'decimal': 'number'
};

// Map param types from subscribable definitions
const PARAM_TYPE_MAP: Record<string, string> = {
  'int': 'number',
  'integer': 'number',
  'text': 'string',
  'string': 'string',
  'boolean': 'boolean',
  'date': 'string',
  'timestamptz': 'string'
};

export function generateTypeDefinitions(
  entities: Record<string, EntityIR>,
  subscribables?: Record<string, SubscribableIR>
): string {
  let output = "";

  // --- Common Filter Types ---
  output += `// Filter operators for search queries
export interface FilterOperators<T> {
  eq?: T;
  ne?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  in?: T[];
  not_in?: T[];
  ilike?: string;
  is_null?: boolean;
}

export type FilterValue<T> = T | FilterOperators<T>;

`;

  for (const [name, entity] of Object.entries(entities)) {
    const pascalName = toPascalCase(name);

    // 1. Generate Entity Interface (Read Model)
    output += `export interface ${pascalName} {\n`;
    for (const col of entity.columns) {
      const tsType = mapPostgresToTs(col.type);
      const nullable = !col.type.toUpperCase().includes('NOT NULL') && !col.type.toUpperCase().includes('PRIMARY KEY');
      output += `  ${col.name}${nullable ? '?' : ''}: ${tsType};\n`;
    }
    output += `}\n\n`;

    // 2. Generate Save Params Interface (Write Model)
    output += `export interface Save${pascalName}Params {\n`;
    for (const col of entity.columns) {
      const tsType = mapPostgresToTs(col.type);
      const isPk = entity.primaryKey.includes(col.name);
      const hasDefault = col.type.toUpperCase().includes('DEFAULT') || col.type.includes('serial');
      const isOptional = isPk || hasDefault || !col.type.toUpperCase().includes('NOT NULL');
      output += `  ${col.name}${isOptional ? '?' : ''}: ${tsType};\n`;
    }
    output += `}\n\n`;

    // 3. Generate Get/Delete Params (PK)
    output += `export interface ${pascalName}PK {\n`;
    for (const pkCol of entity.primaryKey) {
        const col = entity.columns.find(c => c.name === pkCol);
        if (col) {
            output += `  ${col.name}: ${mapPostgresToTs(col.type)};\n`;
        }
    }
    output += `}\n\n`;

    // 4. Generate Search Filters Interface
    output += `export interface ${pascalName}Filters {\n`;
    for (const col of entity.columns) {
      const tsType = mapPostgresToTs(col.type);
      output += `  ${col.name}?: FilterValue<${tsType}>;\n`;
    }
    output += `}\n\n`;

    // 5. Generate Search Params Interface
    output += `export interface Search${pascalName}Params {
  filters?: ${pascalName}Filters;
  sort_field?: keyof ${pascalName};
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}\n\n`;

    // 6. Generate Lookup Params Interface
    output += `export interface Lookup${pascalName}Params {
  q?: string;
  limit?: number;
}\n\n`;
  }

  // --- Subscribable Params ---
  if (subscribables) {
    for (const [name, sub] of Object.entries(subscribables)) {
      const pascalName = toPascalCase(name);

      output += `export interface ${pascalName}Params {\n`;
      for (const [paramName, paramType] of Object.entries(sub.params)) {
        const tsType = PARAM_TYPE_MAP[paramType as string] || 'any';
        output += `  ${paramName}: ${tsType};\n`;
      }
      output += `}\n\n`;
    }
  }

  return output;
}

function mapPostgresToTs(pgType: string): string {
  // Handle arrays: text[] -> string[]
  if (pgType.endsWith('[]')) {
      const base = pgType.slice(0, -2);
      return mapPostgresToTs(base) + '[]';
  }
  
  // Simple map
  for (const [key, val] of Object.entries(TYPE_MAP)) {
      if (pgType.toLowerCase().includes(key)) return val;
  }
  return 'any';
}

function toPascalCase(str: string) {
    return str.replace(/(^|_)([a-z])/g, (g) => g.at(-1).toUpperCase());
}
