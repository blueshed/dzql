// TZQL Entity Definition Example

export const entities = {
  posts: {
    schema: {
      id: 'serial PRIMARY KEY',
      title: 'text NOT NULL',
      content: 'text',
      author_id: 'int NOT NULL', // In a real app, this would reference users(id)
      created_at: 'timestamptz DEFAULT now()'
    },
    permissions: {
      view: [], // Public
      create: ['@author_id == @user_id'], // Only create for self
      update: ['@author_id == @user_id'], // Only owner
      delete: ['@author_id == @user_id']  // Only owner
    },
    graphRules: {
      on_create: {
        actions: [
          { type: 'reactor', name: 'notify_subscribers', params: { post_id: '@id' } }
        ]
      }
    }
  },
  comments: {
    schema: {
      id: 'serial PRIMARY KEY',
      post_id: 'int NOT NULL REFERENCES posts(id) ON DELETE CASCADE',
      content: 'text NOT NULL',
      author_id: 'int NOT NULL'
    },
    permissions: {
      view: [],
      create: [],
      delete: ['@author_id == @user_id']
    }
  }
};

export const subscribables = {
  post_detail: {
    params: { post_id: 'int' },
    root: { entity: 'posts', key: 'post_id' },
    includes: {
      comments: { entity: 'comments', filter: { post_id: '@id' } }
    },
    scopeTables: ['posts', 'comments']
  }
};
