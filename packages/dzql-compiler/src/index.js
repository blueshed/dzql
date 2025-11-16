/**
 * DZQL Compiler
 * Transforms declarative entity definitions into optimized PostgreSQL stored procedures
 */

export { DZQLCompiler, compile, compileAll, compileFromSQL } from './compiler.js';
export { EntityParser, parseEntitiesFromSQL } from './parser/entity-parser.js';
export { PathParser, parsePath, parsePaths } from './parser/path-parser.js';
export { PermissionCodegen, generatePermissionFunctions } from './codegen/permission-codegen.js';
export { OperationCodegen, generateOperations } from './codegen/operation-codegen.js';
export { NotificationCodegen, generateNotificationFunction } from './codegen/notification-codegen.js';
