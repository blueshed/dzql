// TZQL Domain Definition
// Define your entities and subscribables here

export const entities = {
  // Users table with authentication
  users: {
    schema: {
      id: "serial PRIMARY KEY",
      name: "text NOT NULL",
      email: "text UNIQUE NOT NULL",
      password_hash: "text NOT NULL",
      created_at: "timestamptz DEFAULT now()",
    },
    label: "name",
    searchable: ["name", "email"],
    hidden: ["password_hash"],
    permissions: {
      view: [],
      create: [],
      update: ["@id"],
      delete: ["@id"],
    },
  },

  // Posts table - users can create posts
  posts: {
    schema: {
      id: "serial PRIMARY KEY",
      author_id: "int NOT NULL REFERENCES users(id)",
      title: "text NOT NULL",
      content: "text",
      published: "boolean DEFAULT false",
      created_at: "timestamptz DEFAULT now()",
      updated_at: "timestamptz DEFAULT now()",
    },
    label: "title",
    searchable: ["title", "content"],
    includes: {
      author: "users",
    },
    permissions: {
      view: [],
      create: ["@author_id == @user_id"],
      update: ["@author_id == @user_id"],
      delete: ["@author_id == @user_id"],
    },
  },

  // Comments on posts
  comments: {
    schema: {
      id: "serial PRIMARY KEY",
      post_id: "int NOT NULL REFERENCES posts(id) ON DELETE CASCADE",
      author_id: "int NOT NULL REFERENCES users(id)",
      content: "text NOT NULL",
      created_at: "timestamptz DEFAULT now()",
    },
    label: "content",
    searchable: ["content"],
    includes: {
      post: "posts",
      author: "users",
    },
    permissions: {
      view: [],
      create: [],
      update: ["@author_id == @user_id"],
      delete: ["@author_id == @user_id"],
    },
  },
};

// Subscribables define real-time documents
export const subscribables = {
  // Post detail - includes post with author and comments
  post_detail: {
    params: { post_id: "int" },
    root: { entity: "posts", key: "post_id" },
    includes: {
      author: { entity: "users", relation: "author" },
      comments: {
        entity: "comments",
        filter: { post_id: "@id" },
        includes: {
          author: { entity: "users", relation: "author" },
        },
      },
    },
    scopeTables: ["posts", "users", "comments"],
  },

  // User profile with their posts
  user_profile: {
    params: { user_id: "int" },
    root: { entity: "users", key: "user_id" },
    includes: {
      posts: {
        entity: "posts",
        filter: { author_id: "@id" },
      },
    },
    scopeTables: ["users", "posts"],
    canSubscribe: ["@user_id == @user_id"],
  },
};
