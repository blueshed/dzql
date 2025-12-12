/**
 * Test for nested jsonb_build_object parsing fix
 *
 * Bug: The _parseJSONBuildObject method used a greedy regex that matched
 * to the LAST ) instead of the matching closing parenthesis. This broke
 * deeply nested structures.
 */

import { parseEntitiesFromSQL } from "../../packages/dzql/src/compiler/parser/entity-parser.js";

console.log("Testing Nested JSONB Parsing");
console.log("=====");

// This is the exact reproduction case from the bug report
const testSQL = `SELECT dzql.register_entity(
    'organisations',
    'name',
    array['name', 'description'],
    '{}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
        'create', array[]::text[],
        'update', array['@id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    ),
    jsonb_build_object(
        'on_create', jsonb_build_object(
            'establish_ownership', jsonb_build_object(
                'description', 'Creator becomes member of organisation',
                'actions', jsonb_build_array(
                    jsonb_build_object(
                        'type', 'create',
                        'entity', 'acts_for',
                        'data', jsonb_build_object(
                            'user_id', '@user_id',
                            'org_id', '@id',
                            'valid_from', '@today'
                        )
                    )
                )
            )
        )
    )
);`;

const entities = parseEntitiesFromSQL(testSQL);

if (entities.length === 0) {
  console.error("FAILED: No entities parsed");
  process.exit(1);
}

console.log("✓ Parsed", entities.length, "entity");

const entity = entities[0];

if (entity.tableName !== "organisations") {
  console.error("FAILED: Wrong table name:", entity.tableName);
  process.exit(1);
}

console.log("✓ Entity name:", entity.tableName);

// Check graph rules - on_create is in graphRules, not fieldDefaults
const graphRules = entity.graphRules;

if (!graphRules.on_create) {
  console.error("FAILED: on_create not found in graphRules");
  console.log("Got:", JSON.stringify(graphRules, null, 2));
  process.exit(1);
}

console.log("✓ Found on_create graph rule");

const onCreate = graphRules.on_create;
if (!onCreate.establish_ownership) {
  console.error("FAILED: establish_ownership not found");
  console.log("Got:", JSON.stringify(onCreate, null, 2));
  process.exit(1);
}

console.log("✓ Found establish_ownership");

const establishOwnership = onCreate.establish_ownership;
if (!establishOwnership.actions) {
  console.error("FAILED: actions not found");
  console.log("Got:", JSON.stringify(establishOwnership, null, 2));
  process.exit(1);
}

console.log("✓ Found actions");

// actions can be an array or object (single-element array is parsed as object)
const action = Array.isArray(establishOwnership.actions)
  ? establishOwnership.actions[0]
  : establishOwnership.actions;

if (!action || !action.data) {
  console.error("FAILED: action.data not found");
  console.log("Got:", JSON.stringify(action, null, 2));
  process.exit(1);
}

console.log("✓ Found action with data");

// THE KEY TEST: valid_from should be exactly '@today', not '@today' followed by garbage
if (action.data.valid_from !== "@today") {
  console.error("FAILED: valid_from incorrectly parsed");
  console.error("Expected: @today");
  console.error("Got:", JSON.stringify(action.data.valid_from));
  process.exit(1);
}

console.log("✓ valid_from correctly parsed as: @today");

// Also check other fields
if (action.data.user_id !== "@user_id") {
  console.error("FAILED: user_id incorrect:", action.data.user_id);
  process.exit(1);
}

console.log("✓ user_id correctly parsed as: @user_id");

if (action.data.org_id !== "@id") {
  console.error("FAILED: org_id incorrect:", action.data.org_id);
  process.exit(1);
}

console.log("✓ org_id correctly parsed as: @id");

console.log("=====");
console.log("✅ Nested JSONB parsing test passed!");
