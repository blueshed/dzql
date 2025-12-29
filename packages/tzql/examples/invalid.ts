// TZQL Entity Definition Example (INVALID)

export const entities = {
  posts: {
    schema: { id: 'serial PRIMARY KEY' },
    permissions: {}
  }
};

export const subscribables = {
  broken_feed: {
    params: {},
    root: { entity: 'posts' },
    includes: {
      comments: { entity: 'missing_table' } // <--- Error: 'missing_table' does not exist
    }
  }
};
