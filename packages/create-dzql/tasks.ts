import { DzqlNamespace } from "dzql/namespace";

/**
 * Task runner for {{name}}
 *
 * Usage: invt <namespace>:<method> [args...]
 *
 * Available:
 *   dzql:entities                         - List all entities
 *   dzql:subscribables                    - List all subscribables
 *   dzql:functions                        - List all manifest functions
 *   dzql:search <entity> [params]         - Search entity
 *   dzql:get <entity> <pk>                - Get by primary key
 *   dzql:save <entity> <data>             - Create or update
 *   dzql:delete <entity> <pk>             - Delete by primary key
 *   dzql:lookup <entity> [params]         - Lookup for dropdowns
 *   dzql:subscribe <name> [params]        - Get subscribable snapshot
 *   dzql:call <function> [params]         - Call any manifest function
 */
export class Tasks {
  dzql = new DzqlNamespace();
}
