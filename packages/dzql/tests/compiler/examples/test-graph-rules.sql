-- Test entity with graph rules
-- Parameter order: tableName, labelField, searchableFields, fkIncludes, softDelete, temporalFields, notificationPaths, permissionPaths, graphRules
select dzql.register_entity(
  'organisations',
  'name',
  array['name', 'description'],
  jsonb_build_object(
    'org', 'acts_for'
  ),
  false,
  jsonb_build_object(),
  jsonb_build_object(),
  jsonb_build_object(
    'view', array['@owner_id', '@org_id->acts_for[org_id=$]{active}.user_id'],
    'create', array['true'],
    'update', array['@org_id->acts_for[org_id=$]{active}.user_id'],
    'delete', array['@owner_id']
  ),
  jsonb_build_object(
    'on_create', jsonb_build_object(
      'creator_becomes_owner', jsonb_build_object(
        'description', 'Creator becomes owner',
        'actions', jsonb_build_object(
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
);
