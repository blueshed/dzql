// TZQL Entity Definition Example
import type { DomainConfig } from '../src/shared/ir.js';

export const entities: DomainConfig['entities'] = {
  users: {
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text',
      email: 'text UNIQUE NOT NULL',
      password_hash: 'text NOT NULL'
    },
    label: 'name',
    hidden: ['password_hash'],
    permissions: {
      view: [],
      create: [],
      update: ['@id'],
      delete: ['@id']
    }
  },
  posts: {
    schema: {
      id: 'serial PRIMARY KEY',
      title: 'text NOT NULL',
      content: 'text',
      author_id: 'int NOT NULL REFERENCES users(id)',
      created_at: 'timestamptz DEFAULT now()'
    },
    includes: {
      author: 'users'  // FK expansion: include author object
    },
    permissions: {
      view: [], // Public
      create: ['@author_id == @user_id'], // Only create for self
      update: ['@author_id == @user_id'], // Only owner
      delete: ['@author_id == @user_id']  // Only owner
    },
    graphRules: {
      on_create: {
        notify_on_post: {
          description: 'Notify subscribers when a post is created',
          actions: [
            { type: 'reactor', name: 'notify_subscribers', params: { post_id: '@id' } }
          ]
        }
      }
    }
  },
  comments: {
    schema: {
      id: 'serial PRIMARY KEY',
      post_id: 'int NOT NULL REFERENCES posts(id) ON DELETE CASCADE',
      content: 'text NOT NULL',
      author_id: 'int NOT NULL REFERENCES users(id)'
    },
    includes: {
      author: 'users',  // FK expansion: include author object
      post: 'posts'     // FK expansion: include post object
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
