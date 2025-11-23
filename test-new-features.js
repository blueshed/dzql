#!/usr/bin/env bun
/**
 * Test script for new compiler features:
 * 1. Notify actions in graph rules
 * 2. Condition evaluation in graph rules
 * 3. Custom field defaults (@field_name references)
 * 4. {active} temporal marker in permission paths
 */

import { compile } from './packages/dzql/src/compiler/compiler.js';

console.log('🧪 Testing New Compiler Features\n');
console.log('=' .repeat(80));

// Test 1: Notify Actions
console.log('\n📢 Test 1: Notify Actions in Graph Rules');
console.log('-'.repeat(80));

const entityWithNotify = {
  table_name: 'posts',
  label_field: 'title',
  searchable_fields: ['title', 'content'],
  fk_includes: { author: 'users' },
  soft_delete: false,
  temporal_fields: {},
  notification_paths: {},
  permission_paths: {
    view: [],
    create: [],
    update: ['@author_id'],
    delete: ['@author_id']
  },
  graph_rules: {
    on_create: {
      notify_followers: {
        description: 'Notify author followers',
        actions: [{
          type: 'notify',
          users: ['@author_id'],
          message: 'New post created',
          data: { post_id: '@id' }
        }]
      }
    },
    on_update: {
      notify_on_publish: {
        description: 'Notify when status changes to published',
        condition: "@before.status != @after.status AND @after.status = 'published'",
        actions: [{
          type: 'notify',
          users: ['@author_id->users.followers'],
          message: 'Post published'
        }]
      }
    }
  },
  field_defaults: {
    author_id: '@user_id',
    created_at: '@now',
    status: 'draft'
  }
};

try {
  const result = compile(entityWithNotify);
  const sql = result.sql;

  // Save the full SQL for debugging
  // console.log('Full SQL:\n', sql);

  // Check for notify action generation
  if (sql.includes('INSERT INTO dzql.events')) {
    console.log('✅ Notify action SQL generated');
  } else {
    console.log('❌ Notify action SQL NOT generated');
  }

  // Check for condition evaluation - look for p_old_record comparison
  if (sql.includes("p_old_record->>'status'") && sql.includes("p_new_record->>'status'")) {
    console.log('✅ Condition evaluation code generated (@before/@after variables)');
  } else if (sql.includes('IF')) {
    console.log('⚠️  IF block generated but @before/@after variables may not be correct');
  } else {
    console.log('❌ Condition evaluation NOT generated');
  }

  // Check for field defaults
  if (sql.includes('author_id') && sql.includes('p_user_id')) {
    console.log('✅ Field default (@user_id) generated');
  } else {
    console.log('❌ Field default (@user_id) NOT generated');
  }

  // Show relevant snippets
  console.log('\n📝 Generated SQL snippets:');

  // Extract notify action
  const notifyMatch = sql.match(/INSERT INTO dzql\.events[\s\S]{0,300}/);
  if (notifyMatch) {
    console.log('\nNotify Action:');
    console.log(notifyMatch[0].substring(0, 200) + '...');
  }

  // Extract condition IF block
  const conditionMatch = sql.match(/IF.*@before[\s\S]{0,200}/);
  if (conditionMatch) {
    console.log('\nCondition Evaluation:');
    console.log(conditionMatch[0]);
  } else {
    // Try to find the actual condition in the generated code
    const beforeMatch = sql.match(/p_old_record[\s\S]{0,300}/);
    if (beforeMatch) {
      console.log('\nCondition code (using p_old_record):');
      console.log(beforeMatch[0].substring(0, 200) + '...');
    }
  }

} catch (error) {
  console.log('❌ Error compiling entity:', error.message);
  console.log(error.stack);
}

// Test 2: Permission paths with {active}
console.log('\n\n⏰ Test 2: {active} Temporal Marker in Permission Paths');
console.log('-'.repeat(80));

const entityWithTemporal = {
  table_name: 'venues',
  label_field: 'name',
  searchable_fields: ['name'],
  fk_includes: { org: 'organisations' },
  soft_delete: false,
  temporal_fields: {},
  notification_paths: {},
  permission_paths: {
    view: [],
    create: ['@org_id->acts_for[org_id=$]{active}.user_id'],
    update: ['@org_id->acts_for[org_id=$]{active}.user_id'],
    delete: ['@org_id->acts_for[org_id=$]{active}.user_id']
  },
  graph_rules: {},
  field_defaults: {}
};

try {
  const result = compile(entityWithTemporal);
  const sql = result.sql;

  // Check for temporal filtering
  if (sql.includes('valid_from') && sql.includes('valid_to')) {
    console.log('✅ Temporal filtering ({active}) generated');
  } else {
    console.log('❌ Temporal filtering NOT generated');
  }

  // Check for proper temporal conditions
  if (sql.includes('valid_from <= NOW()') && sql.includes('valid_to > NOW()')) {
    console.log('✅ Proper temporal conditions generated (valid_from <= NOW() AND valid_to > NOW())');
  } else if (sql.includes('valid_to IS NULL')) {
    console.log('⚠️  Partial temporal condition (only checks valid_to IS NULL)');
  } else {
    console.log('❌ Temporal conditions NOT generated');
  }

  // Show relevant snippet
  console.log('\n📝 Generated permission function snippet:');
  const temporalMatch = sql.match(/can_create_venues[\s\S]{0,500}/);
  if (temporalMatch) {
    console.log(temporalMatch[0].substring(0, 400) + '...');
  }

} catch (error) {
  console.log('❌ Error compiling entity:', error.message);
}

// Test 3: Custom Field Defaults
console.log('\n\n🔧 Test 3: Custom Field Defaults (@field_name references)');
console.log('-'.repeat(80));

const entityWithCustomDefaults = {
  table_name: 'resources',
  label_field: 'name',
  searchable_fields: ['name'],
  fk_includes: {},
  soft_delete: false,
  temporal_fields: {},
  notification_paths: {},
  permission_paths: {
    view: [],
    create: [],
    update: [],
    delete: []
  },
  graph_rules: {},
  field_defaults: {
    owner_id: '@user_id',
    created_by: '@user_id',
    created_at: '@now',
    modified_by: '@created_by', // References another field!
    status: 'draft'
  }
};

try {
  const result = compile(entityWithCustomDefaults);
  const sql = result.sql;

  // Check for field reference resolution
  if (sql.includes("p_data->>'created_by'")) {
    console.log('✅ Custom field reference (@created_by) generated');
  } else {
    console.log('❌ Custom field reference NOT generated');
  }

  // Check for built-in variables
  if (sql.includes('p_user_id') && sql.includes('owner_id')) {
    console.log('✅ Built-in variable (@user_id) generated');
  }

  if (sql.includes('NOW()') && sql.includes('created_at')) {
    console.log('✅ Built-in variable (@now) generated');
  }

  // Show relevant snippet
  console.log('\n📝 Generated field defaults snippet:');
  const defaultsMatch = sql.match(/Apply field default: modified_by[\s\S]{0,200}/);
  if (defaultsMatch) {
    console.log(defaultsMatch[0]);
  } else {
    console.log('⚠️  Could not find modified_by field default in generated SQL');
  }

} catch (error) {
  console.log('❌ Error compiling entity:', error.message);
}

console.log('\n' + '='.repeat(80));
console.log('✅ Feature testing complete!\n');
