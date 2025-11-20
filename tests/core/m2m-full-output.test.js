import { DZQLCompiler } from './packages/dzql/src/compiler/compiler.js';

const compiler = new DZQLCompiler();

const entity = {
  tableName: 'resources',
  labelField: 'title',
  searchableFields: ['title'],
  fkIncludes: {},
  fieldDefaults: {
    owner_id: '@user_id'
  },
  manyToMany: {
    tags: {
      junction_table: 'resource_tags',
      local_key: 'resource_id',
      foreign_key: 'tag_id',
      target_entity: 'tags',
      id_field: 'tag_ids',
      expand: true
    }
  }
};

const result = compiler.compile(entity);

// Extract just the SAVE function
const saveFunctionMatch = result.sql.match(/-- SAVE operation for resources[\s\S]*?(?=-- DELETE operation)/);

console.log('\n=== COMPILED SAVE FUNCTION WITH M2M ===\n');
console.log(saveFunctionMatch[0]);
console.log('\n=== END ===\n');

// Verify key features
console.log('✅ VERIFICATION:');
console.log('  1. M2M variable declared:', result.sql.includes('v_tag_ids INT[]'));
console.log('  2. M2M extraction:', result.sql.includes("IF p_data ? 'tag_ids' THEN"));
console.log('  3. Junction table sync:', result.sql.includes('DELETE FROM resource_tags'));
console.log('  4. M2M in output:', result.sql.includes("jsonb_build_object('tag_ids'"));
console.log('  5. Field defaults:', result.sql.includes("jsonb_build_object('owner_id', p_user_id)"));
console.log('  6. Event uses v_output:', result.sql.includes('after,\n    user_id,\n    notify_users\n  ) VALUES (\n    \'resources\',\n    CASE WHEN v_is_insert THEN \'insert\' ELSE \'update\' END,\n    jsonb_build_object(\'id\', v_result.id),\n    CASE WHEN NOT v_is_insert THEN to_jsonb(v_existing) ELSE NULL END,\n    v_output,'));
