// domain.ts - DZQL Domain Definition
// Run: bunx dzql domain.ts -o generated

export const entities = {

  // Users table with authentication
  users: {
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text NOT NULL',
      email: 'text UNIQUE NOT NULL',
      password_hash: 'text NOT NULL',
      created_at: 'timestamptz DEFAULT now()'
    },
    label: 'name',
    searchable: ['name', 'email'],
    hidden: ['password_hash'],
    permissions: {
      view: [],
      create: [],
      update: ['@id'],
      delete: []
    }
  },

  // Posts table with author relationship
  posts: {
    schema: {
      id: 'serial PRIMARY KEY',
      author_id: 'int NOT NULL REFERENCES users(id)',
      title: 'text NOT NULL',
      content: 'text',
      published: 'boolean DEFAULT false',
      created_at: 'timestamptz DEFAULT now()'
    },
    label: 'title',
    searchable: ['title', 'content'],
    includes: {
      author: 'users'
    },
    fieldDefaults: {
      author_id: '@user_id',
      created_at: '@now'
    },
    permissions: {
      view: [],
      create: [],
      update: ['@author_id'],
      delete: ['@author_id']
    }
  },

  // Comments on posts
  comments: {
    schema: {
      id: 'serial PRIMARY KEY',
      post_id: 'int NOT NULL REFERENCES posts(id) ON DELETE CASCADE',
      author_id: 'int NOT NULL REFERENCES users(id)',
      content: 'text NOT NULL',
      created_at: 'timestamptz DEFAULT now()'
    },
    label: 'content',
    searchable: ['content'],
    includes: {
      post: 'posts',
      author: 'users'
    },
    fieldDefaults: {
      author_id: '@user_id',
      created_at: '@now'
    },
    permissions: {
      view: [],
      create: [],
      update: ['@author_id'],
      delete: ['@author_id', '@post_id->posts.author_id']
    }
  }

};

// Real-time subscriptions
export const subscribables = {

  // Post detail with comments
  post_detail: {
    params: {
      post_id: 'int'
    },
    root: {
      entity: 'posts',
      key: 'post_id'
    },
    includes: {
      author: 'users',
      comments: {
        entity: 'comments',
        includes: {
          author: 'users'
        }
      }
    },
    scopeTables: ['posts', 'users', 'comments'],
    canSubscribe: []
  },

  // All posts feed
  posts_feed: {
    params: {},
    root: {
      entity: 'posts',
      filter: { published: true }
    },
    includes: {
      author: 'users'
    },
    scopeTables: ['posts', 'users'],
    canSubscribe: []
  }

};
