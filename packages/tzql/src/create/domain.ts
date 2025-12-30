// domain.ts - DZQL Domain Definition
// Run: bunx dzql domain.ts

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
      update: ['@id'],  // Users can only update themselves
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
      created_at: 'timestamptz DEFAULT now()',
      updated_at: 'timestamptz'
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
      view: [],  // Anyone can view
      create: [],  // Anyone logged in can create
      update: ['@author_id'],  // Only author can update
      delete: ['@author_id']   // Only author can delete
    },
    graphRules: {
      on_create: {
        notify_followers: {
          description: 'Notify when new post is created',
          actions: [
            {
              type: 'reactor',
              name: 'new_post',
              params: { post_id: '@id', author_id: '@author_id' }
            }
          ]
        }
      },
      on_update: {
        track_updates: {
          description: 'Set updated_at on edit',
          condition: "@before.title != @after.title OR @before.content != @after.content",
          actions: [
            {
              type: 'update',
              target: 'posts',
              data: { updated_at: '@now' },
              match: { id: '@id' }
            }
          ]
        }
      }
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
      delete: ['@author_id', '@post_id->posts.author_id']  // Author or post owner can delete
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
    canSubscribe: []  // Anyone can subscribe
  },

  // User's posts feed
  my_posts: {
    params: {},
    root: {
      entity: 'users',
      key: '@user_id'
    },
    includes: {
      posts: {
        entity: 'posts',
        filter: { author_id: '@user_id' }
      }
    },
    scopeTables: ['users', 'posts'],
    canSubscribe: []
  }

};
