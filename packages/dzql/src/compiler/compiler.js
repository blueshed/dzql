/**
 * DZQL Compiler
 * Main compiler class that orchestrates parsing and code generation
 */

import { EntityParser, parseEntitiesFromSQL } from './parser/entity-parser.js';
import { SubscribableParser } from './parser/subscribable-parser.js';
import { generatePermissionFunctions } from './codegen/permission-codegen.js';
import { generateOperations } from './codegen/operation-codegen.js';
import { generateNotificationFunction } from './codegen/notification-codegen.js';
import { generateGraphRuleFunctions } from './codegen/graph-rules-codegen.js';
import { generateSubscribable } from './codegen/subscribable-codegen.js';
import { generateAuthFunctions } from './codegen/auth-codegen.js';
import { generateDropSemantics } from './codegen/drop-semantics-codegen.js';
import crypto from 'crypto';

export class DZQLCompiler {
  constructor(options = {}) {
    this.options = {
      includeComments: true,
      includeChecksums: true,
      ...options
    };
    this.parser = new EntityParser();
    this.subscribableParser = new SubscribableParser();
  }

  /**
   * Compile an entity definition to SQL
   * @param {Object} entity - Entity configuration
   * @returns {Object} Compilation result
   */
  compile(entity) {
    const startTime = Date.now();

    // Normalize entity configuration
    const normalizedEntity = this.parser.parseFromObject(entity);

    // Generate SQL sections
    const sections = [];

    // Header
    if (this.options.includeComments) {
      sections.push(this._generateHeader(normalizedEntity));
    }

    // Permission functions
    const permissionSQL = generatePermissionFunctions(
      normalizedEntity.tableName,
      normalizedEntity.permissionPaths
    );
    sections.push(permissionSQL);

    // Operation functions
    const operationSQL = generateOperations(normalizedEntity);
    sections.push(operationSQL);

    // Auth functions (only for users table)
    const authSQL = generateAuthFunctions(normalizedEntity);
    if (authSQL) {
      sections.push(authSQL);
    }

    // Notification path resolution (if needed)
    if (normalizedEntity.notificationPaths &&
        Object.keys(normalizedEntity.notificationPaths).length > 0) {
      sections.push(this._generateNotificationFunction(normalizedEntity));
    }

    // Graph rules (if needed)
    if (normalizedEntity.graphRules &&
        Object.keys(normalizedEntity.graphRules).length > 0) {
      sections.push(this._generateGraphRuleFunctions(normalizedEntity));
    }

    // Custom functions (pass-through from entity definition)
    if (normalizedEntity.customFunctions &&
        normalizedEntity.customFunctions.length > 0) {
      sections.push(this._generateCustomFunctionsSection(normalizedEntity));
    }

    // Combine all sections
    const sql = sections.join('\n\n');

    // Calculate checksum
    const checksum = this._calculateChecksum(sql);

    const result = {
      tableName: normalizedEntity.tableName,
      sql,
      checksum,
      compilationTime: Date.now() - startTime,
      generatedAt: new Date().toISOString()
    };

    return result;
  }

  /**
   * Compile a subscribable definition to SQL
   * @param {Object} subscribable - Subscribable configuration
   * @returns {Object} Compilation result
   */
  compileSubscribable(subscribable) {
    const startTime = Date.now();

    // Normalize subscribable configuration
    const normalized = typeof subscribable.name === 'string'
      ? subscribable
      : this.subscribableParser.parseFromObject(subscribable);

    // Generate SQL
    const sql = generateSubscribable(normalized);

    // Calculate checksum
    const checksum = this._calculateChecksum(sql);

    return {
      name: normalized.name,
      sql,
      checksum,
      compilationTime: Date.now() - startTime,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Compile multiple entities
   * @param {Array} entities - Array of entity configurations
   * @returns {Object} Compilation results
   */
  compileAll(entities) {
    const results = [];
    const errors = [];

    for (const entity of entities) {
      try {
        const result = this.compile(entity);
        results.push(result);
      } catch (error) {
        errors.push({
          entity: entity.tableName || 'unknown',
          error: error.message
        });
      }
    }

    return {
      results,
      errors,
      summary: {
        total: entities.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }

  /**
   * Compile multiple subscribables
   * @param {Array} subscribables - Array of subscribable configurations
   * @returns {Object} Compilation results
   */
  compileAllSubscribables(subscribables) {
    const results = [];
    const errors = [];

    for (const subscribable of subscribables) {
      try {
        const result = this.compileSubscribable(subscribable);
        results.push(result);
      } catch (error) {
        errors.push({
          subscribable: subscribable.name || 'unknown',
          error: error.message
        });
      }
    }

    return {
      results,
      errors,
      summary: {
        total: subscribables.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }

  /**
   * Compile from SQL file
   * @param {string} sqlContent - SQL file content
   * @returns {Object} Compilation results with dropSemantics
   */
  compileFromSQL(sqlContent) {
    // Use parseEntitiesFromSQL to properly extract custom functions
    const entities = parseEntitiesFromSQL(sqlContent);

    if (entities.length === 0) {
      return {
        results: [],
        errors: [],
        summary: { total: 0, successful: 0, failed: 0 },
        dropSemantics: { entities: {} }
      };
    }

    const compilationResult = this.compileAll(entities);

    // Generate drop semantics from all parsed entities
    const dropSemantics = generateDropSemantics(entities);

    return {
      ...compilationResult,
      dropSemantics
    };
  }

  /**
   * Compile subscribables from SQL file
   * @param {string} sqlContent - SQL file content
   * @returns {Object} Compilation results
   */
  compileSubscribablesFromSQL(sqlContent) {
    const subscribables = this.subscribableParser.parseAllFromSQL(sqlContent);

    if (subscribables.length === 0) {
      return {
        results: [],
        errors: [],
        summary: { total: 0, successful: 0, failed: 0 }
      };
    }

    return this.compileAllSubscribables(subscribables);
  }

  /**
   * Generate file header
   * @private
   */
  _generateHeader(entity) {
    return `-- ============================================================================
-- DZQL Compiled Functions for: ${entity.tableName}
-- Generated: ${new Date().toISOString()}
--
-- This file was automatically generated by the DZQL Compiler.
-- Do not edit directly - regenerate from entity definition.
-- ============================================================================`;
  }

  /**
   * Generate notification path resolution function
   * @private
   */
  _generateNotificationFunction(entity) {
    return generateNotificationFunction(
      entity.tableName,
      entity.notificationPaths
    );
  }

  /**
   * Generate graph rule functions
   * @private
   */
  _generateGraphRuleFunctions(entity) {
    return generateGraphRuleFunctions(
      entity.tableName,
      entity.graphRules,
      entity.primaryKey
    );
  }

  /**
   * Generate custom functions section (pass-through from entity definition)
   * @private
   */
  _generateCustomFunctionsSection(entity) {
    const header = `-- ============================================================================
-- Custom Functions for: ${entity.tableName}
-- Pass-through from entity definition
-- ============================================================================`;

    return header + '\n\n' + entity.customFunctions.join('\n\n');
  }

  /**
   * Calculate SHA-256 checksum of SQL
   * @private
   */
  _calculateChecksum(sql) {
    return crypto.createHash('sha256').update(sql).digest('hex');
  }

  /**
   * Format SQL with proper indentation (basic)
   * @private
   */
  _formatSQL(sql) {
    // Basic formatting - could be enhanced
    return sql.trim();
  }
}

/**
 * Compile a single entity
 * @param {Object} entity - Entity configuration
 * @param {Object} options - Compiler options
 * @returns {Object} Compilation result
 */
export function compile(entity, options = {}) {
  const compiler = new DZQLCompiler(options);
  return compiler.compile(entity);
}

/**
 * Compile multiple entities
 * @param {Array} entities - Array of entity configurations
 * @param {Object} options - Compiler options
 * @returns {Object} Compilation results
 */
export function compileAll(entities, options = {}) {
  const compiler = new DZQLCompiler(options);
  return compiler.compileAll(entities);
}

/**
 * Compile from SQL file content
 * @param {string} sqlContent - SQL file content
 * @param {Object} options - Compiler options
 * @returns {Object} Compilation results
 */
export function compileFromSQL(sqlContent, options = {}) {
  const compiler = new DZQLCompiler(options);
  return compiler.compileFromSQL(sqlContent);
}

/**
 * Compile a single subscribable
 * @param {Object} subscribable - Subscribable configuration
 * @param {Object} options - Compiler options
 * @returns {Object} Compilation result
 */
export function compileSubscribable(subscribable, options = {}) {
  const compiler = new DZQLCompiler(options);
  return compiler.compileSubscribable(subscribable);
}

/**
 * Compile multiple subscribables
 * @param {Array} subscribables - Array of subscribable configurations
 * @param {Object} options - Compiler options
 * @returns {Object} Compilation results
 */
export function compileAllSubscribables(subscribables, options = {}) {
  const compiler = new DZQLCompiler(options);
  return compiler.compileAllSubscribables(subscribables);
}

/**
 * Compile subscribables from SQL file content
 * @param {string} sqlContent - SQL file content
 * @param {Object} options - Compiler options
 * @returns {Object} Compilation results
 */
export function compileSubscribablesFromSQL(sqlContent, options = {}) {
  const compiler = new DZQLCompiler(options);
  return compiler.compileSubscribablesFromSQL(sqlContent);
}
